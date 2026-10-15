"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ListMusic, Play } from "lucide-react";

import { SaveTrackButton } from "@/components/playlists/save-track-button";
import { ReportButton } from "@/components/reports/report-button";
import type { DiscoverPlaylist, DiscoverTrack } from "@/lib/discover";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/stores/player";

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function DiscoverView({
  tracks,
  playlists,
  loggedIn,
}: {
  tracks: DiscoverTrack[];
  playlists: DiscoverPlaylist[];
  loggedIn: boolean;
}) {
  function playFrom(id: string) {
    const index = tracks.findIndex((track) => track.id === id);
    if (index < 0) return;
    usePlayer.getState().playQueue(
      tracks.map((track) => ({
        id: track.id,
        kind: "upload" as const,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec,
        artworkUrl: track.hasArtwork ? `/api/tracks/${track.id}/artwork` : null,
      })),
      index,
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-8">
      <section>
        <h2 className="mb-2 text-sm font-bold text-zinc-300">公開プレイリスト</h2>
        {playlists.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-4 py-4 text-xs text-zinc-500">
            まだ公開プレイリストがありません
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <Link
                  href={`/p/${playlist.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3 hover:border-dopa-700"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dopa-800">
                    <ListMusic className="size-4 text-accent" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{playlist.title}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {playlist.ownerName ?? "メンバー"} ・ {playlist.itemCount}曲
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-500">開く →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-zinc-300">公開されている曲</h2>
        {tracks.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-4 py-4 text-xs text-zinc-500">
            まだ公開されている曲がありません
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tracks.map((track) => (
              <li
                key={track.id}
                className="flex items-center gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3"
              >
                <button
                  type="button"
                  onClick={() => playFrom(track.id)}
                  className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dopa-800 hover:ring-2 hover:ring-accent"
                  aria-label={`${track.title} を再生`}
                >
                  {track.hasArtwork ? (
                    <img
                      src={`/api/tracks/${track.id}/artwork`}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Play className="size-4 text-accent" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{track.title}</p>
                  <p className="truncate text-xs text-zinc-400">
                    {track.artist ?? "アーティスト不明"}
                    {track.ownerName ? ` ・ ${track.ownerName}さん` : ""}
                    {track.playCount > 0 ? ` ・ ${track.playCount}回再生` : ""}
                  </p>
                </div>
                {loggedIn && !track.own ? (
                  <>
                    <SaveTrackButton trackId={track.id} initialSaved={track.saved} />
                    <ReportButton targetType="track" targetId={track.id} compact />
                  </>
                ) : null}
                <span className={cn("shrink-0 text-xs text-zinc-500")}>
                  {formatDuration(track.durationSec)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
