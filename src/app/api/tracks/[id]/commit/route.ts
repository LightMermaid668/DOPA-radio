import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { tracks } from "@/db/schema";
import { enqueueTranscode } from "@/lib/jobs";
import { headObject } from "@/lib/s3";
import { getSession } from "@/lib/session";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const track = await db.query.tracks.findFirst({
    where: and(eq(tracks.id, id), eq(tracks.ownerId, session.user.id)),
  });
  if (!track) {
    return NextResponse.json({ error: "トラックが見つかりません" }, { status: 404 });
  }
  if (!track.originalKey) {
    return NextResponse.json({ error: "アップロード情報がありません" }, { status: 400 });
  }

  const exists = await headObject(track.originalKey);
  if (!exists) {
    return NextResponse.json(
      { error: "アップロードが確認できません。もう一度アップロードしてください" },
      { status: 400 },
    );
  }

  await enqueueTranscode(id);

  return NextResponse.json({ ok: true });
}
