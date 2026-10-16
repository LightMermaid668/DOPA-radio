import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { TrackList, type LibraryTrack } from "@/components/library/track-list";
import { db } from "@/db";
import { tracks } from "@/db/schema";
import { auth } from "@/lib/auth";

export const metadata: Metadata = { title: "ライブラリ" };
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/library");

  const { user } = session;

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

  const libraryTracks: LibraryTrack[] = rows.map((row) => ({
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

  return (
    <>
      <section className="pb-5">
        <h1 className="mb-1 text-2xl font-black">ライブラリ</h1>
        <p className="text-sm text-zinc-400">自分の曲を管理して、そのまま再生できます。</p>
      </section>

      <TrackList tracks={libraryTracks} />
    </>
  );
}
