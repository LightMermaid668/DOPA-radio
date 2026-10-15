import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { playlistItems, playlists, tracks } from "@/db/schema";
import { presignGet } from "@/lib/s3";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const playlist = await db.query.playlists.findFirst({ where: eq(playlists.id, id) });
  if (!playlist || playlist.visibility === "private") {
    return new NextResponse(null, { status: 404 });
  }

  const items = await db
    .select({ artworkKey: tracks.artworkKey })
    .from(playlistItems)
    .innerJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .where(eq(playlistItems.playlistId, id))
    .orderBy(asc(playlistItems.position));

  const artworkKey = items.find((item) => item.artworkKey)?.artworkKey;
  if (!artworkKey) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(await presignGet(artworkKey), 302);
}
