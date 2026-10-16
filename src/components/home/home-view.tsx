"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookmarkMinus, Compass, ListMusic, Music2, Pin, PinOff, Play } from "lucide-react";

import { DiscoverView } from "@/components/discover/discover-view";
import { TrackList, type LibraryTrack } from "@/components/library/track-list";
import { NowPlayingIndicator } from "@/components/player/now-playing-indicator";
import { CreatePlaylistForm } from "@/components/playlists/create-playlist-form";
import { ImportPlaylistForm } from "@/components/playlists/import-playlist-form";
import { QrShareButton } from "@/components/share/qr-share-button";
import type { DiscoverPlaylist, DiscoverTrack } from "@/lib/discover";
import { cn } from "@/lib/utils";
import { usePlayer, type PlayerTrack } from "@/stores/player";

export type HomePlaylist = {
  id: string;
  title: string;
  visibility: "private" | "unlisted" | "public";
  itemCount: number;
};

export type SavedTrackView = {
  trackId: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  hasArtwork: boolean;
  ready: boolean;
  ownerName: string | null;
  chorusStartSec: number | null;
  chorusEndSec: number | null;
  pinned: boolean;
};

const VISIBILITY_LABELS: Record<HomePlaylist["visibility"], string> = {
  private: "非公開",
  unlisted: "限定公開",
  public: "公開",
};

export type HomeTab = "library" | "playlists" | "discover";

export function HomeView({
  tracks,
  playlists,
  savedTracks,
  userId,
  userName,
  discover,
  initialTab = "library",
}: {
  tracks: LibraryTrack[];
  playlists: HomePlaylist[];
  savedTracks: SavedTrackView[];
  userId: string;
  userName: string;
  discover: { tracks: DiscoverTrack[]; playlists: DiscoverPlaylist[] };
  initialTab?: HomeTab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<HomeTab>(initialTab);

  function selectTab(next: HomeTab) {
    setTab(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(
        null,
        "",
        next === "library" ? "/home" : `/home?tab=${next}`,
      );
    }
  }

  const currentTrackId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playerIsPlaying = usePlayer((s) => s.isPlaying);

  const pinnedOwn = tracks.filter((track) => track.pinned && track.status === "ready");
  const pinnedSaved = savedTracks.filter((track) => track.pinned && track.ready);
  const playableSaved = savedTracks.filter((track) => track.ready);

  type PinnedCard = {
    id: string;
    title: string;
    artist: string | null;
    hasArtwork: boolean;
    saved: boolean;
  };

  const pinnedCards: PinnedCard[] = [
    ...pinnedOwn.map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      hasArtwork: track.hasArtwork,
      saved: false,
    })),
    ...pinnedSaved.map((track) => ({
      id: track.trackId,
      title: track.title,
      artist: track.artist,
      hasArtwork: track.hasArtwork,
      saved: true,
    })),
  ];

  const pinnedPlayerTracks = new Map<string, PlayerTrack>();
  for (const track of pinnedOwn) {
    pinnedPlayerTracks.set(track.id, {
      id: track.id,
      kind: "upload",
      title: track.title,
      artist: track.artist,
      durationSec: track.durationSec,
      artworkUrl: track.hasArtwork ? `/api/tracks/${track.id}/artwork` : null,
      chorusStartSec: track.chorusStartSec,
      chorusEndSec: track.chorusEndSec,
    });
  }
  for (const track of pinnedSaved) {
    pinnedPlayerTracks.set(track.trackId, {
      id: track.trackId,
      kind: "upload",
      title: track.title,
      artist: track.artist,
      durationSec: track.durationSec,
      artworkUrl: track.hasArtwork ? `/api/tracks/${track.trackId}/artwork` : null,
      chorusStartSec: track.chorusStartSec,
      chorusEndSec: track.chorusEndSec,
    });
  }

  function playPinned(id: string) {
    const queue = pinnedCards
      .map((card) => pinnedPlayerTracks.get(card.id))
      .filter((track): track is PlayerTrack => Boolean(track));
    const index = queue.findIndex((track) => track.id === id);
    if (index < 0) return;
    usePlayer.getState().playQueue(queue, index);
  }

  async function unpin(id: string) {
    await fetch(`/api/tracks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: false }),
    });
    router.refresh();
  }

  async function unpinSaved(trackId: string) {
    await fetch(`/api/saved-tracks/${trackId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: false }),
    });
    router.refresh();
  }

  async function togglePinSaved(track: SavedTrackView) {
    await fetch(`/api/saved-tracks/${track.trackId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !track.pinned }),
    });
    router.refresh();
  }

  function playSaved(trackId: string) {
    const index = playableSaved.findIndex((track) => track.trackId === trackId);
    if (index < 0) return;
    usePlayer.getState().playQueue(
      playableSaved.map((track) => ({
        id: track.trackId,
        kind: "upload" as const,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec,
        artworkUrl: track.hasArtwork ? `/api/tracks/${track.trackId}/artwork` : null,
        chorusStartSec: track.chorusStartSec,
        chorusEndSec: track.chorusEndSec,
      })),
      index,
    );
  }

  async function unsave(trackId: string) {
    await fetch(`/api/saved-tracks/${trackId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      <section>
        <h2 className="mb-2 text-sm font-bold text-zinc-300">ピン留め</h2>
        {pinnedCards.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-4 py-4 text-xs text-zinc-500">
            ライブラリのピンボタンで曲をここに固定できます
          </p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {pinnedCards.map((card) => (
              <div key={card.id} className="relative w-28 shrink-0">
                <button
                  type="button"
                  onClick={() => playPinned(card.id)}
                  className="w-full text-left"
                  aria-label={`${card.title} を再生`}
                >
                  <div className="relative flex aspect-square w-28 items-center justify-center overflow-hidden rounded-xl bg-dopa-800">
                    {card.hasArtwork ? (
                      <img
                        src={`/api/tracks/${card.id}/artwork`}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <Music2 className="size-5 text-zinc-500" />
                    )}
                    {currentTrackId === card.id ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <NowPlayingIndicator playing={playerIsPlaying} />
                      </span>
                    ) : (
                      <span className="absolute bottom-1 right-1 flex size-6 items-center justify-center rounded-full bg-dopa-950/80 text-accent">
                        <Play className="size-3" />
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs font-semibold">{card.title}</p>
                  <p className="truncate text-[10px] text-zinc-500">
                    {card.artist ?? "アーティスト不明"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void (card.saved ? unpinSaved(card.id) : unpin(card.id))}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-dopa-950/80 text-zinc-300 hover:text-accent"
                  aria-label="ピン留めを解除"
                >
                  <PinOff className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => selectTab("library")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-bold transition-colors sm:text-sm",
            tab === "library"
              ? "bg-rainbow animate-rainbow border-transparent text-dopa-950"
              : "border-dopa-700 bg-dopa-900 text-zinc-300 hover:bg-dopa-800",
          )}
        >
          <Music2 className="size-4 shrink-0" />
          ライブラリ
        </button>
        <button
          type="button"
          onClick={() => selectTab("playlists")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-bold transition-colors sm:text-sm",
            tab === "playlists"
              ? "bg-rainbow animate-rainbow border-transparent text-dopa-950"
              : "border-dopa-700 bg-dopa-900 text-zinc-300 hover:bg-dopa-800",
          )}
        >
          <ListMusic className="size-4 shrink-0" />
          プレイリスト
        </button>
        <button
          type="button"
          onClick={() => selectTab("discover")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-bold transition-colors sm:text-sm",
            tab === "discover"
              ? "bg-rainbow animate-rainbow border-transparent text-dopa-950"
              : "border-dopa-700 bg-dopa-900 text-zinc-300 hover:bg-dopa-800",
          )}
        >
          <Compass className="size-4 shrink-0" />
          ディスカバー
        </button>
      </div>

      {tab === "library" ? (
        <div className="flex flex-col gap-8">
          {savedTracks.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-bold text-zinc-300">保存した曲</h2>
              <ul className="flex flex-col gap-2">
                {savedTracks.map((track) => (
                  <li
                    key={track.trackId}
                    className="flex items-center gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => playSaved(track.trackId)}
                      disabled={!track.ready}
                      className={cn(
                        "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg",
                        track.ready
                          ? "bg-dopa-800 hover:ring-2 hover:ring-accent"
                          : "bg-dopa-800/50",
                      )}
                      aria-label="再生"
                    >
                      {track.ready && track.hasArtwork ? (
                        <img
                          src={`/api/tracks/${track.trackId}/artwork`}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <Music2 className="size-4 text-zinc-500" />
                      )}
                      {currentTrackId === track.trackId ? (
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
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void togglePinSaved(track)}
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-dopa-800",
                        track.pinned ? "text-accent" : "text-zinc-400 hover:text-accent",
                      )}
                      aria-label={track.pinned ? "ピン留めを解除" : "ピン留めする"}
                    >
                      <Pin className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => unsave(track.trackId)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-red-400"
                      aria-label="ライブラリから外す"
                    >
                      <BookmarkMinus className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-300">自分の曲</h2>
              <QrShareButton path={`/u/${userId}`} title={`${userName} のライブラリ`} />
            </div>
            <TrackList tracks={tracks} />
          </section>
        </div>
      ) : tab === "playlists" ? (
        <div className="flex flex-col gap-4">
          <CreatePlaylistForm />
          <ImportPlaylistForm />
          {playlists.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-6 py-12 text-center">
              <ListMusic className="size-7 text-zinc-500" />
              <p className="text-sm text-zinc-400">プレイリストを作って仲間に共有しよう</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {playlists.map((playlist) => (
                <li key={playlist.id}>
                  <Link
                    href={`/playlists/${playlist.id}`}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-5 py-4 hover:border-dopa-700"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-bold">{playlist.title}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {VISIBILITY_LABELS[playlist.visibility]} ・ {playlist.itemCount}曲
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-zinc-500">編集 →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <DiscoverView
          tracks={discover.tracks}
          playlists={discover.playlists}
          loggedIn
        />
      )}
    </div>
  );
}
