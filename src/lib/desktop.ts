"use client";

export type DesktopDownload = {
  id: string;
  title: string;
  artist: string | null;
  filename: string;
  path: string;
  completedAt: number;
};

export type AppleMusicPlayResult = {
  ok: boolean;
  status?: "played" | "opened" | "notfound" | "error" | "invalid" | "unsupported";
};

export type DopaDesktopBridge = {
  isDesktop: true;
  platform: string;
  electron: string;
  download: (payload: {
    url: string;
    filename: string;
    trackId?: string;
    title?: string;
    artist?: string | null;
  }) => Promise<{ ok: boolean; path?: string; error?: string; record?: DesktopDownload }>;
  listDownloads: () => Promise<DesktopDownload[]>;
  revealDownload: (id: string) => Promise<{ ok: boolean }>;
  deleteDownload: (id: string) => Promise<{ ok: boolean }>;
  playInAppleMusic: (payload: {
    title: string;
    artist?: string | null;
    deepLink?: string | null;
  }) => Promise<AppleMusicPlayResult>;
};

declare global {
  interface Window {
    dopaDesktop?: DopaDesktopBridge;
  }
}

/** デスクトップアプリ（Electron）内で動作しているか */
export function isDesktopApp(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.dopaDesktop?.isDesktop);
}

export function getDesktop(): DopaDesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.dopaDesktop ?? null;
}

/** 曲のファイル名（"アーティスト - タイトル.m4a"）を作る */
export function trackDownloadFilename(
  title: string,
  artist: string | null | undefined,
): string {
  const safeTitle = title.trim() || "無題のトラック";
  const base = artist?.trim() ? `${artist.trim()} - ${safeTitle}` : safeTitle;
  return `${base}.m4a`;
}

/** ダウンロード済みファイルをアプリ内で再生するためのURL */
export function localFileSrc(id: string): string {
  return `dopa-local://track/${encodeURIComponent(id)}`;
}

export type DownloadTrackInput = {
  id: string;
  title: string;
  artist?: string | null;
};

export type DownloadTracksResult = {
  ok: number;
  failed: number;
};

/** 複数曲を順番にダウンロードする（Electron側も直列処理） */
export async function downloadTracks(
  items: DownloadTrackInput[],
  onProgress?: (done: number, total: number) => void,
): Promise<DownloadTracksResult> {
  const bridge = getDesktop();
  if (!bridge || items.length === 0) return { ok: 0, failed: 0 };

  let ok = 0;
  let failed = 0;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    onProgress?.(index, items.length);
    try {
      const url = new URL(`/api/tracks/${item.id}/file`, window.location.origin).href;
      const result = await bridge.download({
        url,
        filename: trackDownloadFilename(item.title, item.artist),
        trackId: item.id,
        title: item.title,
        artist: item.artist ?? null,
      });
      if (result.ok) {
        ok += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  onProgress?.(items.length, items.length);
  return { ok, failed };
}
