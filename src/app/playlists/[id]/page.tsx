import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft, House } from "lucide-react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  PlaylistDetail,
  type PlaylistDetailData,
  type PlaylistItemData,
} from "@/components/playlists/playlist-detail";
import { db } from "@/db";
import { playlistItems, playlists, tracks } from "@/db/schema";
import { auth } from "@/lib/auth";

export const metadata: Metadata = { title: "プレイリスト編集" };
export const dynamic = "force-dynamic";

export default async function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/playlists");

  const { id } = await params;
  const playlist = await db.query.playlists.findFirst({ where: eq(playlists.id, id) });
  if (!playlist) notFound();

  if (playlist.ownerId !== session.user.id) {
    if (playlist.visibility !== "private") redirect(`/p/${playlist.id}`);
    notFound();
  }

  const rows = await db
    .select({
      itemId: playlistItems.id,
      kind: playlistItems.kind,
      trackId: playlistItems.trackId,
      ownerId: tracks.ownerId,
      externalMeta: playlistItems.externalMeta,
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

  const items: PlaylistItemData[] = rows.map((row) => ({
    itemId: row.itemId,
    kind: row.kind,
    trackId: row.trackId,
    ownerId: row.ownerId,
    title: row.title ?? row.externalMeta?.title ?? null,
    artist: row.artist ?? row.externalMeta?.artist ?? null,
    durationSec:
      row.durationSec ??
      (row.externalMeta?.durationMs != null
        ? Math.round(row.externalMeta.durationMs / 1000)
        : null),
    status: row.status,
    hasArtwork: Boolean(row.artworkKey),
    artworkUrl: row.externalMeta?.artworkUrl ?? null,
    deepLink: row.externalMeta?.deepLink ?? null,
    previewUrl: row.externalMeta?.previewUrl ?? null,
    chorusStartSec: row.chorusStartSec,
    chorusEndSec: row.chorusEndSec,
  }));

  const data: PlaylistDetailData = {
    id: playlist.id,
    title: playlist.title,
    description: playlist.description,
    visibility: playlist.visibility,
    items,
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link
          href="/playlists"
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          プレイリスト一覧
        </Link>
        <div className="flex items-center gap-0.5">
          <Link
            href="/home"
            aria-label="ホーム"
            className="flex size-9 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-zinc-200"
          >
            <House className="size-4.5" />
          </Link>
          <SignOutButton />
        </div>
      </header>

      <PlaylistDetail data={data} currentUserId={session.user.id} />
    </main>
  );
}
