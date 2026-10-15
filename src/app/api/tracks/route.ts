import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { tracks } from "@/db/schema";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      album: tracks.album,
      genre: tracks.genre,
      durationSec: tracks.durationSec,
      status: tracks.status,
      visibility: tracks.visibility,
      playCount: tracks.playCount,
      createdAt: tracks.createdAt,
    })
    .from(tracks)
    .where(eq(tracks.ownerId, session.user.id))
    .orderBy(desc(tracks.createdAt));

  return NextResponse.json({ tracks: rows });
}
