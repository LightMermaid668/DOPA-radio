"use client";

export type DopaDesktopBridge = {
  isDesktop: true;
  platform: string;
  electron: string;
  download: (payload: {
    url: string;
    filename: string;
  }) => Promise<{ ok: boolean; path?: string; error?: string }>;
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
