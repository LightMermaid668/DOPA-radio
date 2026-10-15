import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { savedTracks, tracks } from "@/db/schema";
import { getSession } from "@/lib/session";

type SaveBody = { trackId?: string };

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SaveBody | null;
  const trackId = body?.trackId;
  if (!trackId || typeof trackId !== "string") {
    return NextResponse.json({ error: "trackId が必要です" }, { status: 400 });
  }

  const track = await db.query.tracks.findFirst({ where: eq(tracks.id, trackId) });
  if (!track || track.status !== "ready") {
    return NextResponse.json({ error: "曲が見つかりません" }, { status: 404 });
  }
  if (track.visibility === "private") {
    return NextResponse.json({ error: "非公開の曲は保存できません" }, { status: 400 });
  }
  if (track.ownerId === session.user.id) {
    return NextResponse.json({ error: "自分の曲はすでにライブラリにあります" }, { status: 400 });
  }

  await db
    .insert(savedTracks)
    .values({ userId: session.user.id, trackId: track.id })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true });
}
