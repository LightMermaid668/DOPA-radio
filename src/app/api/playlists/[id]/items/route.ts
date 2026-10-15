import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { playlistItems, playlists, tracks } from "@/db/schema";
import { getSession } from "@/lib/session";

async function getOwnedPlaylistId(playlistId: string, userId: string) {
  const playlist = await db.query.playlists.findFirst({
    where: and(eq(playlists.id, playlistId), eq(playlists.ownerId, userId)),
  });
  return playlist?.id ?? null;
}

type AddBody = { trackIds?: string[] };
type ReorderBody = { itemIds?: string[] };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const ownedId = await getOwnedPlaylistId(id, session.user.id);
  if (!ownedId) {
    return NextResponse.json({ error: "プレイリストが見つかりません" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as AddBody | null;
  const trackIds = body?.trackIds?.filter((trackId) => typeof trackId === "string");
  if (!trackIds?.length || trackIds.length > 100) {
    return NextResponse.json({ error: "追加する曲を指定してください" }, { status: 400 });
  }

  const ownedTracks = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(
      and(
        eq(tracks.ownerId, session.user.id),
        eq(tracks.status, "ready"),
        inArray(tracks.id, trackIds),
      ),
    );
  const ownedIds = new Set(ownedTracks.map((row) => row.id));
  const validIds = trackIds.filter((trackId) => ownedIds.has(trackId));
  if (validIds.length === 0) {
    return NextResponse.json({ error: "追加できる曲がありません" }, { status: 400 });
  }

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${playlistItems.position}), 0)` })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, id));
  const basePosition = Number(maxRow?.max ?? 0);

  await db.insert(playlistItems).values(
    validIds.map((trackId, index) => ({
      playlistId: id,
      kind: "upload" as const,
      trackId,
      position: basePosition + index + 1,
      addedBy: session.user.id,
    })),
  );

  await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, id));

  return NextResponse.json({ ok: true, added: validIds.length });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const ownedId = await getOwnedPlaylistId(id, session.user.id);
  if (!ownedId) {
    return NextResponse.json({ error: "プレイリストが見つかりません" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as ReorderBody | null;
  const itemIds = body?.itemIds?.filter((itemId) => typeof itemId === "string");
  if (!itemIds?.length) {
    return NextResponse.json({ error: "並び順が不正です" }, { status: 400 });
  }

  const existing = await db
    .select({ id: playlistItems.id })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, id));
  const existingIds = new Set(existing.map((row) => row.id));
  const validOrder = itemIds.filter((itemId) => existingIds.has(itemId));
  if (validOrder.length !== existingIds.size) {
    return NextResponse.json({ error: "並び順が不正です" }, { status: 400 });
  }

  for (let index = 0; index < validOrder.length; index++) {
    await db
      .update(playlistItems)
      .set({ position: index + 1 })
      .where(and(eq(playlistItems.id, validOrder[index]), eq(playlistItems.playlistId, id)));
  }

  await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, id));

  return NextResponse.json({ ok: true });
}
