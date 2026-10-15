import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import { user as userTable } from "@/db/auth-schema";
import { playlistItems, playlists, savedTracks, tracks } from "@/db/schema";

export type SearchScope = "library" | "discover";

export type SearchTrack = {
  id: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  hasArtwork: boolean;
  ready: boolean;
  ownerName: string | null;
  own: boolean;
  saved: boolean;
  chorusStartSec: number | null;
  chorusEndSec: number | null;
};

export type SearchPlaylist = {
  id: string;
  title: string;
  description: string | null;
  ownerName: string | null;
  itemCount: number;
  own: boolean;
};

export type SearchResults = {
  tracks: SearchTrack[];
  playlists: SearchPlaylist[];
};

const LIMIT = 20;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

type TrackRow = {
  id: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  artworkKey: string | null;
  status: "processing" | "ready" | "failed";
  chorusStartSec: number | null;
  chorusEndSec: number | null;
};

function toSearchTrack(
  row: TrackRow,
  extra: { own: boolean; saved: boolean; ownerName: string | null },
): SearchTrack {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    durationSec: row.durationSec,
    hasArtwork: Boolean(row.artworkKey),
    ready: row.status === "ready",
    chorusStartSec: row.chorusStartSec,
    chorusEndSec: row.chorusEndSec,
    ...extra,
  };
}

const TRACK_FIELDS = {
  id: tracks.id,
  title: tracks.title,
  artist: tracks.artist,
  durationSec: tracks.durationSec,
  artworkKey: tracks.artworkKey,
  status: tracks.status,
  chorusStartSec: tracks.chorusStartSec,
  chorusEndSec: tracks.chorusEndSec,
};

/**
 * 検索: scope=library は自分の曲+保存した曲+自分のプレイリスト、
 * scope=discover は公開されている曲+公開プレイリストを対象にする。
 * どちらもプレイリスト名（タイトル）を検索対象に含む。
 */
export async function searchContent(
  viewerId: string | null,
  scope: SearchScope,
  rawQuery: string,
): Promise<SearchResults> {
  const term = rawQuery.trim();
  if (!term) return { tracks: [], playlists: [] };

  const pattern = `%${escapeLike(term)}%`;
  const trackMatch = or(
    ilike(tracks.title, pattern),
    ilike(tracks.artist, pattern),
    ilike(tracks.album, pattern),
  );

  if (scope === "library") {
    const ownerId = viewerId;
    if (!ownerId) return { tracks: [], playlists: [] };

    const ownRows = await db
      .select(TRACK_FIELDS)
      .from(tracks)
      .where(and(eq(tracks.ownerId, ownerId), trackMatch))
      .orderBy(desc(tracks.createdAt))
      .limit(LIMIT);

    const savedRows = await db
      .select({ ...TRACK_FIELDS, ownerName: userTable.name })
      .from(savedTracks)
      .innerJoin(tracks, eq(savedTracks.trackId, tracks.id))
      .leftJoin(userTable, eq(tracks.ownerId, userTable.id))
      .where(and(eq(savedTracks.userId, ownerId), trackMatch))
      .orderBy(desc(savedTracks.createdAt))
      .limit(LIMIT);

    const searchTracks: SearchTrack[] = [
      ...ownRows.map((row) =>
        toSearchTrack(row, { own: true, saved: false, ownerName: null }),
      ),
      ...savedRows.map((row) =>
        toSearchTrack(row, { own: false, saved: true, ownerName: row.ownerName ?? null }),
      ),
    ].slice(0, LIMIT);

    const playlistRows = await db
      .select({
        id: playlists.id,
        title: playlists.title,
        description: playlists.description,
        itemCount: count(playlistItems.id),
      })
      .from(playlists)
      .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
      .where(and(eq(playlists.ownerId, ownerId), ilike(playlists.title, pattern)))
      .groupBy(playlists.id)
      .orderBy(desc(playlists.updatedAt))
      .limit(LIMIT);

    return {
      tracks: searchTracks,
      playlists: playlistRows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        ownerName: null,
        itemCount: Number(row.itemCount),
        own: true,
      })),
    };
  }

  const trackRows = await db
    .select({ ...TRACK_FIELDS, ownerId: tracks.ownerId, ownerName: userTable.name })
    .from(tracks)
    .leftJoin(userTable, eq(tracks.ownerId, userTable.id))
    .where(and(eq(tracks.visibility, "public"), eq(tracks.status, "ready"), trackMatch))
    .orderBy(desc(tracks.playCount), desc(tracks.createdAt))
    .limit(LIMIT);

  const savedIds = new Set<string>();
  if (viewerId && trackRows.length > 0) {
    const saved = await db
      .select({ trackId: savedTracks.trackId })
      .from(savedTracks)
      .where(
        and(
          eq(savedTracks.userId, viewerId),
          inArray(
            savedTracks.trackId,
            trackRows.map((row) => row.id),
          ),
        ),
      );
    for (const row of saved) savedIds.add(row.trackId);
  }

  const playlistRows = await db
    .select({
      id: playlists.id,
      title: playlists.title,
      description: playlists.description,
      ownerId: playlists.ownerId,
      ownerName: userTable.name,
      itemCount: count(playlistItems.id),
    })
    .from(playlists)
    .leftJoin(userTable, eq(playlists.ownerId, userTable.id))
    .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
    .where(and(eq(playlists.visibility, "public"), ilike(playlists.title, pattern)))
    .groupBy(playlists.id, userTable.name)
    .orderBy(desc(playlists.updatedAt))
    .limit(LIMIT);

  return {
    tracks: trackRows.map((row) =>
      toSearchTrack(row, {
        own: viewerId === row.ownerId,
        saved: savedIds.has(row.id),
        ownerName: row.ownerName ?? null,
      }),
    ),
    playlists: playlistRows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      ownerName: row.ownerName ?? null,
      itemCount: Number(row.itemCount),
      own: viewerId === row.ownerId,
    })),
  };
}
