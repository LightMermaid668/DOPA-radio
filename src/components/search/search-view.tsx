"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Compass, ListMusic, Loader2, Music2, Play, Search, X } from "lucide-react";

import { SaveTrackButton } from "@/components/playlists/save-track-button";
import { NowPlayingIndicator } from "@/components/player/now-playing-indicator";
import { ReportButton } from "@/components/reports/report-button";
import type { SearchResults, SearchScope, SearchTrack } from "@/lib/search";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/stores/player";

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toPlayerTrack(track: SearchTrack) {
  return {
    id: track.id,
    kind: "upload" as const,
    title: track.title,
    artist: track.artist,
    durationSec: track.durationSec,
    artworkUrl: track.hasArtwork ? `/api/tracks/${track.id}/artwork` : null,
    chorusStartSec: track.chorusStartSec,
    chorusEndSec: track.chorusEndSec,
  };
}

export function SearchView({ loggedIn }: { loggedIn: boolean }) {
  const [scope, setScope] = useState<SearchScope>(loggedIn ? "library" : "discover");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentTrackId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playerIsPlaying = usePlayer((s) => s.isPlaying);

  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/search?q=${encodeURIComponent(trimmed)}&scope=${scope}`,
            { signal: controller.signal },
          );
          if (!res.ok) throw new Error("search failed");
          const body = (await res.json()) as SearchResults;
          setResults({ tracks: body.tracks ?? [], playlists: body.playlists ?? [] });
          setError(null);
        } catch {
          if (!controller.signal.aborted) {
            setError("検索に失敗しました。もう一度お試しください");
            setResults(null);
          }
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, scope]);

  function playFrom(id: string) {
    const playable = (results?.tracks ?? []).filter((track) => track.ready);
    const index = playable.findIndex((track) => track.id === id);
    if (index < 0) return;
    usePlayer.getState().playQueue(playable.map(toPlayerTrack), index);
  }

  const hasResults =
    results !== null && (results.tracks.length > 0 || results.playlists.length > 0);

  return (
    <div className="flex flex-col gap-5 pb-8">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setScope("library")}
          disabled={!loggedIn}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-bold sm:text-sm",
            scope === "library"
              ? "bg-rainbow border-transparent text-dopa-950"
              : "border-dopa-700 bg-dopa-900 text-zinc-300 hover:bg-dopa-800",
            !loggedIn && "cursor-not-allowed opacity-40 hover:bg-dopa-900",
          )}
        >
          <Music2 className="size-4 shrink-0" />
          ライブラリ
        </button>
        <button
          type="button"
          onClick={() => setScope("discover")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-bold sm:text-sm",
            scope === "discover"
              ? "bg-rainbow border-transparent text-dopa-950"
              : "border-dopa-700 bg-dopa-900 text-zinc-300 hover:bg-dopa-800",
          )}
        >
          <Compass className="size-4 shrink-0" />
          ディスカバー
        </button>
      </div>

      {!loggedIn ? (
        <p className="-mt-2 text-[11px] text-zinc-500">
          ライブラリ検索は{" "}
          <Link
            href="/login?redirect=/search"
            className="text-accent underline underline-offset-2"
          >
            ログイン
          </Link>{" "}
          すると使えます
        </p>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="曲名・アーティスト名・プレイリスト名"
          enterKeyHint="search"
          autoFocus
          className="h-11 w-full rounded-xl border border-dopa-700 bg-dopa-900 pl-9 pr-9 text-sm outline-none placeholder:text-zinc-600 focus:border-accent"
          aria-label="検索キーワード"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 hover:bg-dopa-800 hover:text-zinc-300"
            aria-label="クリア"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {!trimmed ? (
        <p className="rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-4 py-4 text-xs text-zinc-500">
          検索する範囲:
          {scope === "library"
            ? "自分の曲・保存した曲・自分のプレイリスト"
            : "公開されている曲・公開プレイリスト"}
          （プレイリスト名も検索できます）
        </p>
      ) : error ? (
        <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-4 text-xs text-red-300">
          {error}
        </p>
      ) : loading && !results ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" />
          検索中…
        </div>
      ) : results && !hasResults ? (
        <p className="rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-4 py-4 text-xs text-zinc-500">
          「{trimmed}」に一致する曲・プレイリストは見つかりませんでした
        </p>
      ) : results ? (
        <div className="flex flex-col gap-8">
          {results.tracks.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-bold text-zinc-300">
                曲（{results.tracks.length}）
              </h2>
              <ul className="flex flex-col gap-2">
                {results.tracks.map((track) => (
                  <li
                    key={track.id}
                    className="flex items-center gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => playFrom(track.id)}
                      disabled={!track.ready}
                      className={cn(
                        "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dopa-800",
                        track.ready ? "hover:ring-2 hover:ring-accent" : "opacity-50",
                      )}
                      aria-label={track.ready ? `${track.title} を再生` : "再生できません"}
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
                      {currentTrackId === track.id ? (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/60">
                          <NowPlayingIndicator playing={playerIsPlaying} />
                        </span>
                      ) : null}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{track.title}</p>
                      <p className="truncate text-xs text-zinc-400">
                        {track.artist ?? "アーティスト不明"}
                        {track.ownerName ? ` ・ ${track.ownerName}さん` : ""}
                        {track.saved ? " ・ 保存済み" : ""}
                      </p>
                    </div>
                    {loggedIn && !track.own ? (
                      <>
                        <SaveTrackButton trackId={track.id} initialSaved={track.saved} />
                        <ReportButton targetType="track" targetId={track.id} compact />
                      </>
                    ) : null}
                    <span className="shrink-0 text-xs text-zinc-500">
                      {formatDuration(track.durationSec)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.playlists.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-bold text-zinc-300">
                プレイリスト（{results.playlists.length}）
              </h2>
              <ul className="flex flex-col gap-2">
                {results.playlists.map((playlist) => (
                  <li key={playlist.id}>
                    <Link
                      href={playlist.own ? `/playlists/${playlist.id}` : `/p/${playlist.id}`}
                      className="flex items-center gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3 hover:border-dopa-700"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dopa-800">
                        <ListMusic className="size-4 text-accent" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{playlist.title}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {playlist.ownerName ?? "自分のプレイリスト"} ・ {playlist.itemCount}曲
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-zinc-500">
                        {playlist.own ? "編集 →" : "開く →"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
