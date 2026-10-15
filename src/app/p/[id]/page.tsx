import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Library } from "lucide-react";

import { Logo } from "@/components/logo";
import { ImportPlaylistButton } from "@/components/playlists/import-playlist-button";
import { PublicPlayButton, type PublicTrack } from "@/components/playlists/public-play-button";
import { SaveTrackButton } from "@/components/playlists/save-track-button";
import { ReportButton } from "@/components/reports/report-button";
import { db } from "@/db";
import { playlistItems, playlists, savedTracks, tracks } from "@/db/schema";
import { user } from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function getPlaylist(id: string) {
  const playlist = await db.query.playlists.findFirst({ where: eq(playlists.id, id) });
  if (!playlist || playlist.visibility === "private") return null;
  return playlist;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const playlist = await getPlaylist(id);
  if (!playlist) return { title: "DOPA-radio" };

  const description =
    playlist.description ?? `DOPA-radioのプレイリスト「${playlist.title}」`;

  return {
    title: playlist.title,
    description,
    openGraph: {
      title: `${playlist.title} | DOPA-radio`,
      description,
      type: "music.playlist",
      url: `/p/${playlist.id}`,
    },
  };
}

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function PublicPlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const playlist = await getPlaylist(id);
  if (!playlist) notFound();

  const owner = await db.query.user.findFirst({ where: eq(user.id, playlist.ownerId) });

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
    })
    .from(playlistItems)
    .leftJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .where(eq(playlistItems.playlistId, playlist.id))
    .orderBy(asc(playlistItems.position));

  const session = await auth.api.getSession({ headers: await headers() });

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

  const displayItems = rows.map((row) => ({
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
  }));

  const playableTracks: PublicTrack[] = displayItems
    .map((item): PublicTrack | null => {
      if (item.kind === "upload") {
        if (!item.trackId || item.status !== "ready") return null;
        return {
          id: item.trackId,
          kind: "upload" as const,
          title: item.title ?? "無題のトラック",
          artist: item.artist,
          durationSec: item.durationSec,
          artworkUrl: item.hasArtwork ? `/api/tracks/${item.trackId}/artwork` : null,
        };
      }
      if (!item.title) return null;
      return {
        id: `${item.kind}:${item.itemId}`,
        kind: item.kind,
        title: item.title,
        artist: item.artist,
        durationSec: item.durationSec,
        artworkUrl: item.artworkUrl,
        previewUrl: item.previewUrl,
        deepLink: item.deepLink,
      };
    })
    .filter((track): track is PublicTrack => track !== null);

  const hasCover =
    displayItems.some((item) => item.kind === "upload" && item.hasArtwork) ||
    displayItems.some((item) => item.artworkUrl);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6">
      <header className="py-6">
        <Link href="/">
          <Logo />
        </Link>
      </header>

      <section className="flex flex-col gap-4 pb-8">
        <div className="flex items-center gap-4">
          <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-dopa-800">
            {hasCover ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/api/playlists/${playlist.id}/cover`}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <span className="text-xs text-zinc-500">DOPA</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-zinc-500">プレイリスト</p>
            <h1 className="text-2xl font-black">{playlist.title}</h1>
            {playlist.description ? (
              <p className="mt-1 text-sm text-zinc-400">{playlist.description}</p>
            ) : null}
            <p className="mt-1 text-xs text-zinc-500">
              {owner?.name ?? "メンバー"} ・ {playableTracks.length}曲
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <PublicPlayButton redirectTo={`/p/${playlist.id}`} tracks={playableTracks} />
          <ImportPlaylistButton playlistId={playlist.id} ownerId={playlist.ownerId} />
        </div>
        <p className="text-xs text-zinc-500">再生には会員登録が必要です</p>
      </section>

      <ul className="flex flex-col gap-1 pb-16">
        {displayItems.map((item, index) => (
          <li
            key={item.itemId}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2",
              item.kind === "upload" && !item.hasArtwork && !item.title
                ? "bg-dopa-900/40"
                : "bg-dopa-900",
            )}
          >
            <span className="w-5 shrink-0 text-right text-xs text-zinc-500">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold">
                  {item.title ?? "不明なトラック"}
                </p>
                {item.kind !== "upload" ? (
                  <span className="shrink-0 rounded-full bg-dopa-800 px-2 py-0.5 text-[9px] font-bold text-zinc-300">
                    {item.kind === "apple" ? "Apple Music" : "Spotify"}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs text-zinc-400">
                {item.artist ?? "アーティスト不明"}
              </p>
            </div>
            {session && item.kind === "upload" && item.trackId && item.ownerId !== session.user.id ? (
              <SaveTrackButton
                trackId={item.trackId}
                initialSaved={savedTrackIds.has(item.trackId)}
              />
            ) : null}
            {item.kind === "upload" && item.ownerId ? (
              <Link
                href={session?.user.id === item.ownerId ? "/home" : `/u/${item.ownerId}`}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-zinc-200"
                aria-label="ライブラリへ"
                title="ライブラリへ"
              >
                <Library className="size-3.5" />
              </Link>
            ) : null}
            <span className="shrink-0 text-xs text-zinc-500">
              {formatDuration(item.durationSec)}
            </span>
          </li>
        ))}
      </ul>

      {session ? (
        <div className="flex justify-end border-t border-dopa-800 pt-4 pb-16">
          <ReportButton targetType="playlist" targetId={playlist.id} />
        </div>
      ) : null}
    </main>
  );
}
