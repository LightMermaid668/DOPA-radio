import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { playlistItems, playlists, tracks } from "@/db/schema";
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
  const source = await db.query.playlists.findFirst({ where: eq(playlists.id, id) });
  if (
    !source ||
    (source.visibility === "private" && source.ownerId !== session.user.id)
  ) {
    return NextResponse.json({ error: "プレイリストが見つかりません" }, { status: 404 });
  }

  const rows = await db
    .select({
      kind: playlistItems.kind,
      trackId: playlistItems.trackId,
      externalId: playlistItems.externalId,
      externalMeta: playlistItems.externalMeta,
      trackVisibility: tracks.visibility,
    })
    .from(playlistItems)
    .leftJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .where(eq(playlistItems.playlistId, source.id))
    .orderBy(asc(playlistItems.position));

  const items = rows.filter((row) => {
    if (row.kind !== "upload") return true;
    // 非公開トラックはコピー先で再生できないため除外
    return row.trackVisibility !== null && row.trackVisibility !== "private";
  });

  const [created] = await db
    .insert(playlists)
    .values({
      ownerId: session.user.id,
      title: source.title,
      description: source.description,
      visibility: "private",
    })
    .returning({ id: playlists.id });

  if (items.length > 0) {
    await db.insert(playlistItems).values(
      items.map((item, index) => ({
        playlistId: created.id,
        kind: item.kind,
        trackId: item.trackId,
        externalId: item.externalId,
        externalMeta: item.externalMeta,
        position: index + 1,
        addedBy: session.user.id,
      })),
    );
  }

  return NextResponse.json({ id: created.id, count: items.length });
}
