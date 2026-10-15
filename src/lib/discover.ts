import { and, count, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { user as userTable } from "@/db/auth-schema";
import { playlistItems, playlists, savedTracks, tracks } from "@/db/schema";

export type DiscoverTrack = {
  id: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  hasArtwork: boolean;
  ownerName: string | null;
  playCount: number;
  saved: boolean;
  own: boolean;
};

export type DiscoverPlaylist = {
  id: string;
  title: string;
  description: string | null;
  ownerName: string | null;
  itemCount: number;
};

export async function getDiscoverData(viewer: { id: string } | null): Promise<{
  tracks: DiscoverTrack[];
  playlists: DiscoverPlaylist[];
}> {
  const trackRows = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      durationSec: tracks.durationSec,
      artworkKey: tracks.artworkKey,
      ownerId: tracks.ownerId,
      ownerName: userTable.name,
      playCount: tracks.playCount,
    })
    .from(tracks)
    .leftJoin(userTable, eq(tracks.ownerId, userTable.id))
    .where(and(eq(tracks.visibility, "public"), eq(tracks.status, "ready")))
    .orderBy(desc(tracks.playCount), desc(tracks.createdAt))
    .limit(100);

  const savedIds = new Set<string>();
  if (viewer && trackRows.length > 0) {
    const saved = await db
      .select({ trackId: savedTracks.trackId })
      .from(savedTracks)
      .where(
        and(
          eq(savedTracks.userId, viewer.id),
          inArray(
            savedTracks.trackId,
            trackRows.map((row) => row.id),
          ),
        ),
      );
    for (const row of saved) savedIds.add(row.trackId);
  }

  const discoverTracks: DiscoverTrack[] = trackRows.map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    durationSec: row.durationSec,
    hasArtwork: Boolean(row.artworkKey),
    ownerName: row.ownerName,
    playCount: row.playCount,
    saved: savedIds.has(row.id),
    own: viewer?.id === row.ownerId,
  }));

  const playlistRows = await db
    .select({
      id: playlists.id,
      title: playlists.title,
      description: playlists.description,
      ownerName: userTable.name,
      itemCount: count(playlistItems.id),
    })
    .from(playlists)
    .leftJoin(userTable, eq(playlists.ownerId, userTable.id))
    .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
    .where(eq(playlists.visibility, "public"))
    .groupBy(playlists.id, userTable.name)
    .orderBy(desc(playlists.updatedAt))
    .limit(50);

  const discoverPlaylists: DiscoverPlaylist[] = playlistRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    ownerName: row.ownerName,
    itemCount: Number(row.itemCount),
  }));

  return { tracks: discoverTracks, playlists: discoverPlaylists };
}
