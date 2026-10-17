"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckSquare,
  Download,
  ListPlus,
  Loader2,
  MoreVertical,
  Pencil,
  Pin,
  Play,
  Radio,
  Scissors,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { ChorusEditor } from "@/components/library/chorus-editor";
import { TracksDownloadButton } from "@/components/desktop/download-buttons";
import { NowPlayingIndicator } from "@/components/player/now-playing-indicator";
import { buttonVariants, Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/dialog";
import { showToast } from "@/components/ui/toast";
import { getDesktop, isDesktopApp, trackDownloadFilename } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/stores/player";

export type LibraryTrack = {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  durationSec: number | null;
  status: "processing" | "ready" | "failed";
  visibility: "private" | "unlisted" | "public";
  playCount: number;
  transcodeError: string | null;
  hasArtwork: boolean;
  pinned: boolean;
  chorusStartSec: number | null;
  chorusEndSec: number | null;
  chorusSource: string | null;
};

const VISIBILITY_LABELS: Record<LibraryTrack["visibility"], string> = {
  private: "非公開",
  unlisted: "限定公開",
  public: "公開",
};

const VISIBILITY_ORDER: LibraryTrack["visibility"][] = ["public", "unlisted", "private"];

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type MenuState = {
  track: LibraryTrack;
  top?: number;
  bottom?: number;
  right: number;
};

const MENU_ESTIMATED_HEIGHT = 320;

export function TrackList({ tracks }: { tracks: LibraryTrack[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editArtist, setEditArtist] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [chorusTrack, setChorusTrack] = useState<LibraryTrack | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkVisibility, setBulkVisibility] = useState<LibraryTrack["visibility"]>("public");
  const [bulkBusy, setBulkBusy] = useState(false);

  const currentTrackId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playerIsPlaying = usePlayer((s) => s.isPlaying);

  const processing = tracks.some((track) => track.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [processing, router]);

  // メニュー表示中はスクロール/リサイズで閉じる（位置ズレ防止）
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const readyTracks = tracks.filter((track) => track.status === "ready");
  const selectedReadyTracks = tracks.filter(
    (track) => selected.has(track.id) && track.status === "ready",
  );

  function openMenu(track: LibraryTrack, button: HTMLButtonElement) {
    const rect = button.getBoundingClientRect();
    const openUp =
      rect.bottom + MENU_ESTIMATED_HEIGHT > window.innerHeight &&
      rect.top > MENU_ESTIMATED_HEIGHT;
    setMenu({
      track,
      right: Math.max(8, window.innerWidth - rect.right),
      top: openUp ? undefined : rect.bottom + 6,
      bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
    });
  }

  function playFrom(id: string) {
    const index = readyTracks.findIndex((track) => track.id === id);
    if (index < 0) return;
    usePlayer.getState().playQueue(
      readyTracks.map((track) => ({
        id: track.id,
        kind: "upload" as const,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec,
        artworkUrl: track.hasArtwork ? `/api/tracks/${track.id}/artwork` : null,
        chorusStartSec: track.chorusStartSec,
        chorusEndSec: track.chorusEndSec,
      })),
      index,
    );
  }

  async function patchTrack(id: string, patch: Record<string, unknown>) {
    setBusyId(id);
    try {
      await fetch(`/api/tracks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTrack(id: string, title: string) {
    const confirmed = await confirmDialog({
      title: `「${title}」を削除しますか？`,
      description: "元に戻せません。",
      confirmLabel: "削除",
      danger: true,
    });
    if (!confirmed) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/tracks/${id}`, { method: "DELETE" });
      if (res.ok) {
        usePlayer.getState().removeTrack(id);
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(track: LibraryTrack) {
    setEditingId(track.id);
    setEditTitle(track.title);
    setEditArtist(track.artist ?? "");
  }

  async function downloadTrack(track: LibraryTrack) {
    const bridge = getDesktop();
    if (!bridge) return;
    try {
      const url = new URL(`/api/tracks/${track.id}/file`, window.location.origin).href;
      const result = await bridge.download({
        url,
        filename: trackDownloadFilename(track.title, track.artist),
      });
      if (result.ok) {
        showToast(`ダウンロードしました（${track.title}）`, "success");
      } else {
        showToast(result.error ?? "ダウンロードに失敗しました", "error");
      }
    } catch {
      showToast("ダウンロードに失敗しました", "error");
    }
  }

  async function addSimilar(track: LibraryTrack) {
    try {
      const queueIds = usePlayer.getState().queue.map((item) => item.id);
      const params = new URLSearchParams({ seed: track.id });
      if (queueIds.length > 0) {
        params.set("exclude", queueIds.slice(-50).join(","));
      }
      const res = await fetch(`/api/radio/next?${params.toString()}`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        tracks?: Array<{
          id: string;
          title: string;
          artist: string | null;
          durationSec: number | null;
          hasArtwork: boolean;
        }>;
      };
      const similar = body.tracks ?? [];
      if (similar.length === 0) return;

      const toPlayerTrack = (item: (typeof similar)[number]) => ({
        id: item.id,
        kind: "upload" as const,
        title: item.title,
        artist: item.artist,
        durationSec: item.durationSec,
        artworkUrl: item.hasArtwork ? `/api/tracks/${item.id}/artwork` : null,
      });

      if (usePlayer.getState().queue.length === 0) {
        usePlayer.getState().playQueue(similar.map(toPlayerTrack), 0);
        return;
      }
      for (const item of similar) {
        usePlayer.getState().queueAdd(toPlayerTrack(item));
      }
    } catch {
      /* 失敗時は何もしない */
    }
  }

  async function saveEdit(id: string) {
    await patchTrack(id, { title: editTitle, artist: editArtist });
    setEditingId(null);
  }

  function toggleSelectMode() {
    setSelectMode((previous) => {
      if (previous) setSelected(new Set());
      return !previous;
    });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(tracks.map((track) => track.id)));
  }

  async function applyBulk() {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      await fetch("/api/tracks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], visibility: bulkVisibility }),
      });
      setSelected(new Set());
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-6 py-16 text-center">
        <UploadCloud className="size-8 text-zinc-500" aria-hidden />
        <div>
          <p className="font-bold text-zinc-300">まだ曲がありません</p>
          <p className="mt-1 text-xs text-zinc-500">最初の一曲をアップロードしよう</p>
        </div>
        <Link href="/upload" className={cn(buttonVariants())}>
          アップロード
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-zinc-500">{tracks.length}曲</span>
        <button
          type="button"
          onClick={toggleSelectMode}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
            selectMode
              ? "border-accent text-accent"
              : "border-dopa-700 text-zinc-300 hover:bg-dopa-800",
          )}
        >
          <CheckSquare className="size-3.5" />
          {selectMode ? "選択をやめる" : "選択"}
        </button>
      </div>

      {selectMode ? (
        <div className="animate-pop mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dopa-700 bg-dopa-900 px-3 py-2 text-xs">
          <span className="font-semibold text-accent">{selected.size}件</span>
          <span className="text-zinc-400">の公開範囲を</span>
          <select
            value={bulkVisibility}
            onChange={(e) => setBulkVisibility(e.target.value as LibraryTrack["visibility"])}
            className="h-7 rounded-lg border border-dopa-700 bg-dopa-950 px-1.5 text-[11px] text-zinc-300 outline-none focus:border-accent"
            aria-label="一括公開範囲"
          >
            {VISIBILITY_ORDER.map((key) => (
              <option key={key} value={key}>
                {VISIBILITY_LABELS[key]}
              </option>
            ))}
          </select>
          <span className="text-zinc-400">に変更</span>
          <Button
            type="button"
            size="sm"
            onClick={applyBulk}
            disabled={bulkBusy || selected.size === 0}
          >
            {bulkBusy ? "適用中…" : "適用"}
          </Button>
          <TracksDownloadButton
            items={selectedReadyTracks.map((track) => ({
              id: track.id,
              title: track.title,
              artist: track.artist,
            }))}
            label={`DL（${selectedReadyTracks.length}）`}
          />
          <button
            type="button"
            onClick={selectAll}
            className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
          >
            すべて選択
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
          >
            選択解除
          </button>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {tracks.map((track, index) => {
          const ready = track.status === "ready";
          const failed = track.status === "failed";
          return (
            <li
              key={track.id}
              className="animate-row rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3"
              style={{ animationDelay: `${Math.min(index * 25, 200)}ms` }}
            >
              <div className="flex items-center gap-3">
                {selectMode ? (
                  <input
                    type="checkbox"
                    checked={selected.has(track.id)}
                    onChange={() => toggleSelected(track.id)}
                    className="size-4 shrink-0 accent-fuchsia-500"
                    aria-label={`${track.title} を選択`}
                  />
                ) : null}

                <button
                  type="button"
                  onClick={() => playFrom(track.id)}
                  disabled={!ready}
                  className={cn(
                    "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg",
                    ready ? "bg-dopa-800 hover:ring-2 hover:ring-accent" : "bg-dopa-800/50",
                  )}
                  aria-label={ready ? `${track.title} を再生` : "再生できません"}
                >
                  {ready ? (
                    <>
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
                    </>
                  ) : track.status === "processing" ? (
                    <Loader2 className="size-4 animate-spin text-zinc-500" />
                  ) : (
                    <AlertTriangle className="size-4 text-red-400" />
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  {editingId === track.id ? (
                    <div className="flex flex-col gap-1.5">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        maxLength={200}
                        placeholder="タイトル"
                        className="h-8 rounded-lg border border-dopa-700 bg-dopa-950 px-2 text-sm outline-none focus:border-accent"
                      />
                      <input
                        value={editArtist}
                        onChange={(e) => setEditArtist(e.target.value)}
                        maxLength={200}
                        placeholder="アーティスト"
                        className="h-8 rounded-lg border border-dopa-700 bg-dopa-950 px-2 text-xs outline-none focus:border-accent"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        {track.pinned ? (
                          <Pin className="size-3 shrink-0 text-accent" aria-label="ピン留め中" />
                        ) : null}
                        <p className="truncate text-sm font-semibold">{track.title}</p>
                      </div>
                      <p className="truncate text-xs text-zinc-400">
                        {track.artist ?? "アーティスト不明"}
                        {" ・ "}
                        {formatDuration(track.durationSec)}
                      </p>
                    </>
                  )}
                </div>

                {track.status === "processing" ? (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                    変換中
                  </span>
                ) : null}
                {failed ? (
                  <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                    変換失敗
                  </span>
                ) : null}

                {editingId === track.id ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => saveEdit(track.id)}
                      disabled={busyId === track.id}
                      className="flex size-8 items-center justify-center rounded-full text-accent hover:bg-dopa-800"
                      aria-label="保存"
                    >
                      <Check className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="flex size-8 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800"
                      aria-label="キャンセル"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(event) => openMenu(track, event.currentTarget)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-zinc-200"
                    aria-label="メニュー"
                  >
                    <MoreVertical className="size-4" />
                  </button>
                )}
              </div>

              {failed && track.transcodeError ? (
                <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-300">
                  {track.transcodeError}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {chorusTrack ? (
        <ChorusEditor track={chorusTrack} onClose={() => setChorusTrack(null)} />
      ) : null}

      {menu && typeof document !== "undefined"
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-[69]"
                onClick={() => setMenu(null)}
                aria-hidden
              />
              <div
                className="animate-pop fixed z-[70] max-h-[80dvh] w-48 overflow-y-auto rounded-xl border border-dopa-700 bg-dopa-900 p-1.5 shadow-2xl"
                style={{ top: menu.top, bottom: menu.bottom, right: menu.right }}
              >
                <button
                  type="button"
                  onClick={() => {
                    const track = menu.track;
                    setMenu(null);
                    void patchTrack(track.id, { pinned: !track.pinned });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-dopa-800"
                >
                  <Pin className="size-3.5" />
                  {menu.track.pinned ? "ピン留めを解除" : "ピン留めする"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const track = menu.track;
                    setMenu(null);
                    usePlayer.getState().queueAdd({
                      id: track.id,
                      kind: "upload",
                      title: track.title,
                      artist: track.artist,
                      durationSec: track.durationSec,
                      artworkUrl: track.hasArtwork
                        ? `/api/tracks/${track.id}/artwork`
                        : null,
                      chorusStartSec: track.chorusStartSec,
                      chorusEndSec: track.chorusEndSec,
                    });
                  }}
                  disabled={menu.track.status !== "ready"}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-dopa-800 disabled:opacity-40"
                >
                  <ListPlus className="size-3.5" />
                  キューに追加
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const track = menu.track;
                    setMenu(null);
                    startEdit(track);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-dopa-800"
                >
                  <Pencil className="size-3.5" />
                  編集
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const track = menu.track;
                    setMenu(null);
                    void addSimilar(track);
                  }}
                  disabled={menu.track.status !== "ready"}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-dopa-800 disabled:opacity-40"
                >
                  <Radio className="size-3.5" />
                  似てる曲を追加（ドパモード）
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const track = menu.track;
                    setMenu(null);
                    setChorusTrack(track);
                  }}
                  disabled={menu.track.status !== "ready"}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-dopa-800 disabled:opacity-40"
                >
                  <Scissors className="size-3.5" />
                  サビ範囲を設定
                </button>
                {isDesktopApp() ? (
                  <button
                    type="button"
                    onClick={() => {
                      const track = menu.track;
                      setMenu(null);
                      void downloadTrack(track);
                    }}
                    disabled={menu.track.status !== "ready"}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-dopa-800 disabled:opacity-40"
                  >
                    <Download className="size-3.5" />
                    ダウンロード
                  </button>
                ) : null}

                <div className="my-1 h-px bg-dopa-800" />
                <p className="px-2.5 pb-1 pt-0.5 text-[10px] text-zinc-500">公開範囲</p>
                {VISIBILITY_ORDER.map((visibility) => (
                  <button
                    key={visibility}
                    type="button"
                    onClick={() => {
                      const track = menu.track;
                      setMenu(null);
                      void patchTrack(track.id, { visibility });
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-dopa-800"
                  >
                    {VISIBILITY_LABELS[visibility]}
                    {menu.track.visibility === visibility ? (
                      <Check className="size-3.5 text-accent" />
                    ) : null}
                  </button>
                ))}

                <div className="my-1 h-px bg-dopa-800" />
                <button
                  type="button"
                  onClick={() => {
                    const track = menu.track;
                    setMenu(null);
                    void deleteTrack(track.id, track.title);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-400 hover:bg-dopa-800"
                >
                  <Trash2 className="size-3.5" />
                  削除
                </button>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
