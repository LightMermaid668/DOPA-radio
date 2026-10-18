import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { user as userTable } from "@/db/auth-schema";
import { playlistItems, playlists, savedTracks, tracks } from "@/db/schema";
import { getSession } from "@/lib/session";

/**
 * 公開プレイリストのJSON（ネイティブアプリ向け）。
 * 非公開は所有者のみ。未ログインでも公開・限定公開は閲覧できる。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  const playlist = await db.query.playlists.findFirst({ where: eq(playlists.id, id) });
  if (!playlist) {
    return NextResponse.json({ error: "プレイリストが見つかりません" }, { status: 404 });
  }
  const isOwner = session?.user.id === playlist.ownerId;
  if (playlist.visibility === "private" && !isOwner) {
    return NextResponse.json({ error: "プレイリストが見つかりません" }, { status: 404 });
  }

  const ownerRows = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, playlist.ownerId));
  const ownerName = ownerRows[0]?.name ?? null;

  const rows = await db
    .select({
      itemId: playlistItems.id,
      kind: playlistItems.kind,
      trackId: playlistItems.trackId,
      externalMeta: playlistItems.externalMeta,
      ownerId: tracks.ownerId,
      title: tracks.title,
      artist: tracks.artist,
      durationSec: tracks.durationSec,
      status: tracks.status,
      artworkKey: tracks.artworkKey,
      chorusStartSec: tracks.chorusStartSec,
      chorusEndSec: tracks.chorusEndSec,
    })
    .from(playlistItems)
    .leftJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .where(eq(playlistItems.playlistId, playlist.id))
    .orderBy(asc(playlistItems.position));

  const savedTrackIds = new Set<string>();
  if (session) {
    const uploadTrackIds = rows
      .filter((row) => row.kind === "upload" && row.trackId)
      .map((row) => row.trackId as string);
    if (uploadTrackIds.length > 0) {
      const savedRows = await db
        .select({ trackId: savedTracks.trackId })
        .from(savedTracks)
        .where(
          and(
            eq(savedTracks.userId, session.user.id),
            inArray(savedTracks.trackId, uploadTrackIds),
          ),
        );
      for (const saved of savedRows) savedTrackIds.add(saved.trackId);
    }
  }

  const items = rows.map((row) => ({
    itemId: row.itemId,
    kind: row.kind,
    trackId: row.trackId,
    ownerId: row.ownerId,
    status: row.status,
    hasArtwork: Boolean(row.artworkKey),
    title: row.title ?? row.externalMeta?.title ?? null,
    artist: row.artist ?? row.externalMeta?.artist ?? null,
    durationSec:
      row.durationSec ??
      (row.externalMeta?.durationMs != null
        ? Math.round(row.externalMeta.durationMs / 1000)
        : null),
    artworkUrl: row.externalMeta?.artworkUrl ?? null,
    deepLink: row.externalMeta?.deepLink ?? null,
    previewUrl: row.externalMeta?.previewUrl ?? null,
    chorusStartSec: row.chorusStartSec,
    chorusEndSec: row.chorusEndSec,
    saved: row.trackId ? savedTrackIds.has(row.trackId) : false,
  }));

  return NextResponse.json({
    playlist: {
      id: playlist.id,
      title: playlist.title,
      description: playlist.description,
      ownerId: playlist.ownerId,
      ownerName,
      own: isOwner,
    },
    items,
  });
}
