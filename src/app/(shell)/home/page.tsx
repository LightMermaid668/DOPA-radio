import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { count, desc, eq } from "drizzle-orm";

import { HomeView, type HomePlaylist, type HomeTab, type SavedTrackView } from "@/components/home/home-view";
import type { LibraryTrack } from "@/components/library/track-list";
import { db } from "@/db";
import { playlistItems, playlists, savedTracks, tracks } from "@/db/schema";
import { user as userTable } from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import { getDiscoverData } from "@/lib/discover";

export const metadata: Metadata = { title: "ホーム" };
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/home");

  const { user } = session;
  const { tab } = await searchParams;
  const initialTab: HomeTab = tab === "playlists" ? "playlists" : tab === "discover" ? "discover" : "library";

  const trackRows = await db
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
      transcodeError: tracks.transcodeError,
      artworkKey: tracks.artworkKey,
      pinnedAt: tracks.pinnedAt,
      chorusStartSec: tracks.chorusStartSec,
      chorusEndSec: tracks.chorusEndSec,
      chorusSource: tracks.chorusSource,
    })
    .from(tracks)
    .where(eq(tracks.ownerId, user.id))
    .orderBy(desc(tracks.createdAt));

  const libraryTracks: LibraryTrack[] = trackRows.map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: row.genre,
    durationSec: row.durationSec,
    status: row.status,
    visibility: row.visibility,
    playCount: row.playCount,
    transcodeError: row.transcodeError,
    hasArtwork: Boolean(row.artworkKey),
    pinned: Boolean(row.pinnedAt),
    chorusStartSec: row.chorusStartSec,
    chorusEndSec: row.chorusEndSec,
    chorusSource: row.chorusSource,
  }));

  const playlistRows = await db
    .select({
      id: playlists.id,
      title: playlists.title,
      visibility: playlists.visibility,
      itemCount: count(playlistItems.id),
    })
    .from(playlists)
    .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
    .where(eq(playlists.ownerId, user.id))
    .groupBy(playlists.id)
    .orderBy(desc(playlists.updatedAt));

  const homePlaylists: HomePlaylist[] = playlistRows.map((row) => ({
    id: row.id,
    title: row.title,
    visibility: row.visibility,
    itemCount: Number(row.itemCount),
  }));

  const savedRows = await db
    .select({
      trackId: savedTracks.trackId,
      title: tracks.title,
      artist: tracks.artist,
      durationSec: tracks.durationSec,
      artworkKey: tracks.artworkKey,
      status: tracks.status,
      ownerName: userTable.name,
      chorusStartSec: tracks.chorusStartSec,
      chorusEndSec: tracks.chorusEndSec,
      pinnedAt: savedTracks.pinnedAt,
    })
    .from(savedTracks)
    .innerJoin(tracks, eq(savedTracks.trackId, tracks.id))
    .leftJoin(userTable, eq(tracks.ownerId, userTable.id))
    .where(eq(savedTracks.userId, user.id))
    .orderBy(desc(savedTracks.createdAt));

  const savedTracksView: SavedTrackView[] = savedRows.map((row) => ({
    trackId: row.trackId,
    title: row.title,
    artist: row.artist,
    durationSec: row.durationSec,
    hasArtwork: Boolean(row.artworkKey),
    ready: row.status === "ready",
    ownerName: row.ownerName,
    chorusStartSec: row.chorusStartSec,
    chorusEndSec: row.chorusEndSec,
    pinned: Boolean(row.pinnedAt),
  }));

  const discover = await getDiscoverData(user);

  return (
    <HomeView
      tracks={libraryTracks}
      playlists={homePlaylists}
      savedTracks={savedTracksView}
      userId={user.id}
      userName={user.name}
      discover={discover}
      initialTab={initialTab}
    />
  );
}
