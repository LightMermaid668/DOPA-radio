"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { showToast } from "@/components/ui/toast";
import {
  downloadTracks,
  isDesktopApp,
  type DownloadTrackInput,
} from "@/lib/desktop";
import { cn } from "@/lib/utils";

/** デスクトップアプリ内でのみ true になる（SSR不一致を回避するためマウント後判定） */
function useDesktopReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(isDesktopApp());
  }, []);
  return ready;
}

/** まとめてダウンロードするボタン（デスクトップアプリ専用） */
export function TracksDownloadButton({
  items,
  className,
  label = "全曲ダウンロード",
}: {
  items: DownloadTrackInput[];
  className?: string;
  label?: string;
}) {
  const desktopReady = useDesktopReady();
  const [busy, setBusy] = useState(false);

  if (!desktopReady || items.length === 0) return null;

  async function run() {
    if (busy) return;
    setBusy(true);
    showToast(`${items.length}曲のダウンロードを開始します…`);
    try {
      const { ok, failed } = await downloadTracks(items);
      if (failed === 0) {
        showToast(`${ok}曲をダウンロードしました`, "success");
      } else if (ok > 0) {
        showToast(`${ok}曲保存・${failed}曲は失敗しました`, "error");
      } else {
        showToast("ダウンロードに失敗しました", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dopa-700 px-3 text-xs font-semibold text-zinc-200 transition-colors hover:bg-dopa-800 disabled:opacity-60",
        className,
      )}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Download className="size-3.5" />
      )}
      {busy ? "DL中…" : label}
    </button>
  );
}

/** 1曲だけダウンロードするアイコンボタン（デスクトップアプリ専用） */
export function TrackDownloadIconButton({
  track,
  className,
}: {
  track: DownloadTrackInput;
  className?: string;
}) {
  const desktopReady = useDesktopReady();
  const [busy, setBusy] = useState(false);

  if (!desktopReady) return null;

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const { ok } = await downloadTracks([track]);
      if (ok > 0) {
        showToast(`ダウンロードしました（${track.title}）`, "success");
      } else {
        showToast("ダウンロードに失敗しました", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-dopa-800 hover:text-zinc-200 disabled:opacity-50",
        className,
      )}
      aria-label="ダウンロード"
      title="ダウンロード"
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Download className="size-3.5" />
      )}
    </button>
  );
}
