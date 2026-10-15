"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Loader2,
  Pencil,
  Play,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { buttonVariants, Button } from "@/components/ui/button";
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
};

const VISIBILITY_LABELS: Record<LibraryTrack["visibility"], string> = {
  private: "非公開",
  unlisted: "限定公開",
  public: "公開",
};

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TrackList({ tracks }: { tracks: LibraryTrack[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editArtist, setEditArtist] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkVisibility, setBulkVisibility] = useState<LibraryTrack["visibility"]>("private");
  const [bulkBusy, setBulkBusy] = useState(false);

  const processing = tracks.some((track) => track.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [processing, router]);

  const readyTracks = tracks.filter((track) => track.status === "ready");

  function playFrom(id: string) {
    const index = readyTracks.findIndex((track) => track.id === id);
    if (index < 0) return;
    usePlayer.getState().playQueue(
      readyTracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec,
        artworkUrl: track.hasArtwork ? `/api/tracks/${track.id}/artwork` : null,
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
    if (!window.confirm(`「${title}」を削除しますか？元に戻せません。`)) return;
    setBusyId(id);
    try {
      await fetch(`/api/tracks/${id}`, { method: "DELETE" });
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

  async function saveEdit(id: string) {
    await patchTrack(id, { title: editTitle, artist: editArtist });
    setEditingId(null);
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
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dopa-800 bg-dopa-900/60 px-3 py-2 text-xs">
        {selected.size > 0 ? (
          <>
            <span className="font-semibold text-accent">{selected.size}件</span>
            <span className="text-zinc-400">の公開範囲を</span>
            <select
              value={bulkVisibility}
              onChange={(e) => setBulkVisibility(e.target.value as LibraryTrack["visibility"])}
              className="h-7 rounded-lg border border-dopa-700 bg-dopa-950 px-1.5 text-[11px] text-zinc-300 outline-none focus:border-accent"
              aria-label="一括公開範囲"
            >
              {(Object.keys(VISIBILITY_LABELS) as Array<keyof typeof VISIBILITY_LABELS>).map(
                (key) => (
                  <option key={key} value={key}>
                    {VISIBILITY_LABELS[key]}
                  </option>
                ),
              )}
            </select>
            <span className="text-zinc-400">に変更</span>
            <Button type="button" size="sm" onClick={applyBulk} disabled={bulkBusy}>
              {bulkBusy ? "適用中…" : "適用"}
            </Button>
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
          </>
        ) : (
          <span className="text-zinc-500">
            チェックを付けると公開範囲をまとめて変更できます
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {tracks.map((track) => {
        const ready = track.status === "ready";
        const failed = track.status === "failed";
        return (
          <li
            key={track.id}
            className="rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selected.has(track.id)}
                onChange={() => toggleSelected(track.id)}
                className="size-4 shrink-0 accent-fuchsia-500"
                aria-label={`${track.title} を選択`}
              />
              <button
                type="button"
                onClick={() => playFrom(track.id)}
                disabled={!ready}
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg",
                  ready ? "bg-dopa-800 hover:ring-2 hover:ring-accent" : "bg-dopa-800/50",
                )}
                aria-label={ready ? `${track.title} を再生` : "再生できません"}
              >
                {ready ? (
                  track.hasArtwork ? (
                    <img
                      src={`/api/tracks/${track.id}/artwork`}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Play className="size-4 text-accent" />
                  )
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
                    <p className="truncate text-sm font-semibold">{track.title}</p>
                    <p className="truncate text-xs text-zinc-400">
                      {track.artist ?? "アーティスト不明"}
                      {" ・ "}
                      {formatDuration(track.durationSec)}
                    </p>
                  </>
                )}
              </div>

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
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      ready && "bg-dopa-800 text-zinc-300",
                      track.status === "processing" && "bg-amber-500/15 text-amber-400",
                      failed && "bg-red-500/15 text-red-400",
                    )}
                  >
                    {ready ? "再生可" : track.status === "processing" ? "変換中" : "変換失敗"}
                  </span>

                  <select
                    value={track.visibility}
                    onChange={(e) => patchTrack(track.id, { visibility: e.target.value })}
                    disabled={busyId === track.id}
                    className="h-7 rounded-lg border border-dopa-700 bg-dopa-950 px-1.5 text-[11px] text-zinc-300 outline-none focus:border-accent"
                    aria-label="公開範囲"
                  >
                    {(Object.keys(VISIBILITY_LABELS) as Array<keyof typeof VISIBILITY_LABELS>).map(
                      (key) => (
                        <option key={key} value={key}>
                          {VISIBILITY_LABELS[key]}
                        </option>
                      ),
                    )}
                  </select>

                  <button
                    type="button"
                    onClick={() => startEdit(track)}
                    className="flex size-8 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-zinc-200"
                    aria-label="編集"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTrack(track.id, track.title)}
                    disabled={busyId === track.id}
                    className="flex size-8 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-red-400"
                    aria-label="削除"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
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
    </div>
  );
}
