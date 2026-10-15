import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";

import { PublicPlayButton, type PublicTrack } from "@/components/playlists/public-play-button";
import { db } from "@/db";
import { playlistItems, playlists, tracks } from "@/db/schema";
import { user } from "@/db/auth-schema";
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
      trackId: playlistItems.trackId,
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

  const playableTracks: PublicTrack[] = rows
    .filter(
      (row) => row.trackId && row.status === "ready" && row.title,
    )
    .map((row) => ({
      id: row.trackId as string,
      title: row.title as string,
      artist: row.artist,
      durationSec: row.durationSec,
    }));

  const hasCover = rows.some((row) => row.artworkKey);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6">
      <header className="py-6">
        <Link href="/" className="text-lg font-black tracking-tight">
          DOPA<span className="text-accent">-radio</span>
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

        <div className="flex items-center gap-3">
          <PublicPlayButton playlistId={playlist.id} tracks={playableTracks} />
          <p className="text-xs text-zinc-500">
            再生には会員登録が必要です
          </p>
        </div>
      </section>

      <ul className="flex flex-col gap-1 pb-16">
        {rows.map((row, index) => (
          <li
            key={row.itemId}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2",
              row.status === "ready" ? "bg-dopa-900" : "bg-dopa-900/40",
            )}
          >
            <span className="w-5 shrink-0 text-right text-xs text-zinc-500">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{row.title ?? "不明なトラック"}</p>
              <p className="truncate text-xs text-zinc-400">
                {row.artist ?? "アーティスト不明"}
              </p>
            </div>
            <span className="shrink-0 text-xs text-zinc-500">
              {formatDuration(row.durationSec)}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
