"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Pause, Play, RotateCcw, Scissors, X } from "lucide-react";

import type { LibraryTrack } from "@/components/library/track-list";
import { Button } from "@/components/ui/button";
import { usePlayer } from "@/stores/player";

function formatTime(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ChorusEditor({
  track,
  onClose,
}: {
  track: LibraryTrack;
  onClose: () => void;
}) {
  const router = useRouter();
  const [start, setStart] = useState<number | null>(track.chorusStartSec);
  const [end, setEnd] = useState<number | null>(track.chorusEndSec);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const progress = usePlayer((s) => s.progress);
  const duration = usePlayer((s) => s.duration);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const current = usePlayer((s) => s.queue[s.index] ?? null);
  const isCurrent = current?.id === track.id;
  const totalDuration = isCurrent && duration > 0 ? duration : (track.durationSec ?? 0);

  // 未解析の曲（サビデータ無し）は開いた時に自動検出を実行
  const autoRequestedRef = useRef(false);
  useEffect(() => {
    if (autoRequestedRef.current) return;
    if (track.status !== "ready") return;
    if (track.chorusSource != null || track.chorusStartSec != null) return;
    autoRequestedRef.current = true;
    void (async () => {
      try {
        await fetch(`/api/tracks/${track.id}/chorus/detect`, { method: "POST" });
        setNotice("サビを自動検出しています（数秒後に反映）…");
        let attempts = 0;
        const timer = window.setInterval(async () => {
          attempts += 1;
          try {
            const res = await fetch(`/api/tracks/${track.id}`);
            if (res.ok) {
              const body = (await res.json()) as {
                track?: {
                  chorusStartSec?: number | null;
                  chorusEndSec?: number | null;
                  chorusSource?: string | null;
                };
              };
              const value = body.track;
              if (value?.chorusSource === "auto" && value.chorusStartSec != null) {
                window.clearInterval(timer);
                setStart(value.chorusStartSec);
                setEnd(value.chorusEndSec ?? null);
                setNotice("サビを検出しました");
                router.refresh();
                return;
              }
              if (value?.chorusSource === "none") {
                window.clearInterval(timer);
                setNotice("自動検出できませんでした。手動で範囲を設定してください");
                router.refresh();
                return;
              }
            }
          } catch {
            /* ポーリング続行 */
          }
          if (attempts >= 8) {
            window.clearInterval(timer);
            setNotice("自動検出できませんでした。手動で範囲を設定してください");
          }
        }, 2500);
      } catch {
        setNotice("自動検出を開始できませんでした");
      }
    })();
  }, [track, router]);

  // プレビュー終了監視（サビ終端で停止）
  useEffect(() => {
    if (!previewing) return;
    if (!isCurrent) {
      setPreviewing(false);
      return;
    }
    if (end != null && progress >= end - 0.05) {
      setPreviewing(false);
      const state = usePlayer.getState();
      if (state.isPlaying) state.togglePlay();
    }
  }, [previewing, end, isCurrent, progress]);

  function startPlaybackFrom(position: number) {
    const store = usePlayer.getState();
    if (isCurrent) {
      store.seekTo(position);
      return;
    }
    store.playQueue(
      [
        {
          id: track.id,
          kind: "upload",
          title: track.title,
          artist: track.artist,
          durationSec: track.durationSec,
          artworkUrl: track.hasArtwork ? `/api/tracks/${track.id}/artwork` : null,
          chorusStartSec: start,
          chorusEndSec: end,
        },
      ],
      0,
    );
    window.setTimeout(() => {
      const state = usePlayer.getState();
      state.seekTo(position);
      if (!state.isPlaying) state.togglePlay();
    }, 350);
  }

  function togglePreview() {
    if (start == null || end == null || end - start < 5) {
      setNotice("先に開始と終了の位置を設定してください");
      return;
    }
    if (previewing && isCurrent) {
      setPreviewing(false);
      const state = usePlayer.getState();
      if (state.isPlaying) state.togglePlay();
      return;
    }
    setPreviewing(true);
    setNotice(null);
    startPlaybackFrom(start);
    if (isCurrent && !isPlaying) {
      window.setTimeout(() => {
        const state = usePlayer.getState();
        if (!state.isPlaying) state.togglePlay();
      }, 100);
    }
  }

  async function save() {
    if (start == null || end == null || end - start < 5) {
      setNotice("開始と終了の位置を設定してください（5秒以上）");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chorusStartSec: start, chorusEndSec: end }),
      });
      if (res.ok) {
        router.refresh();
        onClose();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setNotice(body?.error ?? "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function resetAuto() {
    setBusy(true);
    setNotice(null);
    try {
      await fetch(`/api/tracks/${track.id}/chorus/detect`, { method: "POST" });
      setStart(null);
      setEnd(null);
      setNotice("サビを再解析しています（数秒後に反映されます）");
      window.setTimeout(() => router.refresh(), 6000);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="animate-fade fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-black/70"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-6">
        <div
          className="animate-pop flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-dopa-700 bg-dopa-900 p-5"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-sm font-bold">
                <Scissors className="size-4 text-accent" />
                サビ範囲を設定
              </h2>
              <p className="mt-1 truncate text-xs text-zinc-400">{track.title}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800"
              aria-label="閉じる"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="rounded-xl border border-dopa-800 bg-dopa-950 px-3 py-2 text-center">
            <p className="font-mono text-lg text-zinc-200">
              {formatTime(progress)} <span className="text-xs text-zinc-500">/ {formatTime(totalDuration)}</span>
            </p>
            <p className="mt-0.5 text-[10px] text-zinc-500">
              サビ: <span className="text-accent">{formatTime(start)} 〜 {formatTime(end)}</span>
              {track.chorusSource === "auto" ? "（自動検出）" : track.chorusSource === "manual" ? "（手動設定）" : ""}
            </p>
          </div>

          {!isCurrent ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                startPlaybackFrom(start ?? 0);
                window.setTimeout(() => {
                  const state = usePlayer.getState();
                  if (!state.isPlaying) state.togglePlay();
                }, 350);
              }}
            >
              <Play className="size-3.5" />
              この曲を再生して調整する
            </Button>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!isCurrent}
              onClick={() => setStart(Math.floor(progress))}
            >
              現在位置を開始に
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!isCurrent}
              onClick={() => setEnd(Math.floor(progress))}
            >
              現在位置を終了に
            </Button>
          </div>

          <Button type="button" size="sm" onClick={togglePreview} disabled={busy}>
            {previewing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {previewing ? "試聴を停止" : "サビを試聴"}
          </Button>

          <p className="text-[10px] leading-relaxed text-zinc-500">
            曲を再生しながら「現在位置を開始/終了に」を押すと範囲を決められます。ドパモードの「サビだけ」でこの区間を中心に楽しめます。
          </p>

          {notice ? <p className="text-xs text-amber-300">{notice}</p> : null}

          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={save} disabled={busy}>
              <Check className="size-3.5" />
              {busy ? "処理中…" : "保存"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetAuto}
              disabled={busy}
            >
              <RotateCcw className="size-3.5" />
              自動検出に戻す
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
