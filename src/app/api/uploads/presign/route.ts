import { NextResponse } from "next/server";
import path from "node:path";

import { db } from "@/db";
import { tracks } from "@/db/schema";
import { presignPut } from "@/lib/s3";
import { getSession } from "@/lib/session";

const EXT_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".webm": "audio/webm",
};

const MAX_SIZE_BYTES = 100 * 1024 * 1024;

type PresignBody = {
  filename?: string;
  size?: number;
  rightsConfirmed?: boolean;
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as PresignBody | null;
  if (!body?.filename) {
    return NextResponse.json({ error: "filename が必要です" }, { status: 400 });
  }
  if (!body.rightsConfirmed) {
    return NextResponse.json({ error: "権利確認への同意が必要です" }, { status: 400 });
  }
  if (!body.size || body.size <= 0 || body.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "ファイルサイズは 100MB 以下にしてください" },
      { status: 400 },
    );
  }

  const ext = path.extname(body.filename).toLowerCase();
  const contentType = EXT_CONTENT_TYPES[ext];
  if (!contentType) {
    return NextResponse.json(
      { error: "対応していない形式です（mp3 / m4a / aac / wav / flac / ogg）" },
      { status: 400 },
    );
  }

  const title = path.basename(body.filename, ext).slice(0, 200) || "無題のトラック";
  const trackId = crypto.randomUUID();
  const originalKey = `original/${trackId}${ext}`;

  await db.insert(tracks).values({
    id: trackId,
    ownerId: session.user.id,
    title,
    status: "processing",
    visibility: "private",
    rightsConfirmed: true,
    originalKey,
  });

  const uploadUrl = await presignPut(originalKey, contentType, 3600);

  return NextResponse.json({ trackId, uploadUrl, contentType });
}
