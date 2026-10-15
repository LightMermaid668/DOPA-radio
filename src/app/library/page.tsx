import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { TrackList, type LibraryTrack } from "@/components/library/track-list";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db";
import { tracks } from "@/db/schema";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";

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
  }));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Logo />
        <div className="flex items-center gap-4">
          <span className="hidden text-xs text-zinc-400 sm:inline">{user.name}</span>
          <Link
            href="/playlists"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            プレイリスト
          </Link>
          <Link href="/upload" className={cn(buttonVariants({ size: "sm" }))}>
            アップロード
          </Link>
          <SignOutButton />
        </div>
      </header>

      <section className="pb-6">
        <h1 className="mb-1 text-2xl font-black">ライブラリ</h1>
        <p className="text-sm text-zinc-400">自分の曲を管理して、そのまま再生できます。</p>
      </section>

      <TrackList tracks={libraryTracks} />
    </main>
  );
}
