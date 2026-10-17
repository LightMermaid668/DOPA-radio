"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FolderOpen, Music2, Play, Trash2 } from "lucide-react";

import { confirmDialog } from "@/components/ui/dialog";
import { NowPlayingIndicator } from "@/components/player/now-playing-indicator";
import { showToast } from "@/components/ui/toast";
import {
  getDesktop,
  isDesktopApp,
  localFileSrc,
  type DesktopDownload,
} from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { usePlayer, type PlayerTrack } from "@/stores/player";

function formatDate(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "";
  }
}

export function DownloadsView() {
  const [desktopApp, setDesktopApp] = useState<boolean | null>(null);
  const [records, setRecords] = useState<DesktopDownload[]>([]);
  const currentTrackId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playerIsPlaying = usePlayer((s) => s.isPlaying);

  const refresh = useCallback(async () => {
    const bridge = getDesktop();
    if (!bridge) {
      setRecords([]);
      return;
    }
    const list = await bridge.listDownloads();
    setRecords(list);
  }, []);

  useEffect(() => {
    const desktop = isDesktopApp();
    setDesktopApp(desktop);
    if (desktop) void refresh();
  }, [refresh]);

  function playFrom(record: DesktopDownload) {
    const index = records.findIndex((item) => item.id === record.id);
    const queue: PlayerTrack[] = records.map((item) => ({
      id: item.id,
      kind: "upload",
      title: item.title,
      artist: item.artist,
      durationSec: null,
      artworkUrl: null,
      localSrc: localFileSrc(item.id),
    }));
    if (queue.length === 0) return;
    usePlayer.getState().playQueue(queue, Math.max(0, index));
  }

  async function reveal(record: DesktopDownload) {
    await getDesktop()?.revealDownload(record.id);
  }

  async function remove(record: DesktopDownload) {
    const confirmed = await confirmDialog({
      title: `「${record.title}」を削除しますか？`,
      description: "保存済みのファイルとリストから削除されます。",
      confirmLabel: "削除",
      danger: true,
    });
    if (!confirmed) return;
    await getDesktop()?.deleteDownload(record.id);
    showToast("削除しました", "success");
    void refresh();
  }

  if (desktopApp === null) return null;

  if (!desktopApp) {
    return (
      <p className="rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-4 py-6 text-xs text-zinc-500">
        ダウンロード済みリストはデスクトップアプリで使える機能です。ライブラリの曲メニューから「ダウンロード」するとここに表示されます。
      </p>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-6 py-14 text-center">
        <Download className="size-7 text-zinc-500" aria-hidden />
        <p className="text-sm text-zinc-400">
          まだダウンロードした曲がありません
        </p>
        <p className="text-xs text-zinc-500">
          ライブラリやプレイリストの「ダウンロード」から保存できます
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {records.map((record, index) => {
        const isCurrent = currentTrackId === record.id;
        return (
          <li
            key={record.id}
            className="animate-row flex items-center gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3"
            style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}
          >
            <button
              type="button"
              onClick={() => playFrom(record)}
              className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dopa-800 hover:ring-2 hover:ring-accent"
              aria-label={`${record.title} を再生`}
            >
              <Music2 className="size-4 text-accent" />
              {isCurrent ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <NowPlayingIndicator playing={playerIsPlaying} />
                </span>
              ) : null}
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{record.title}</p>
              <p className="truncate text-xs text-zinc-400">
                {record.artist ?? "アーティスト不明"} ・ {formatDate(record.completedAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => playFrom(record)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-accent"
              aria-label="再生"
              title="再生"
            >
              <Play className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void reveal(record)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-zinc-200"
              aria-label="フォルダで表示"
              title="フォルダで表示"
            >
              <FolderOpen className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void remove(record)}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-red-400",
              )}
              aria-label="削除"
              title="削除"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
