"use client";

let audio: HTMLAudioElement | null = null;

export function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS 13+ は Macintosh を名乗るためタッチ対応で判定
  return (
    ua.includes("Macintosh") && typeof document !== "undefined" && "ontouchend" in document
  );
}

/**
 * HLS（m3u8）を使うのは iOS/iPadOS のみ。
 * macOS Chrome などは canPlayType が対応と答えても <audio> での HLS 再生に
 * 失敗することがあるため、それ以外は AAC ファイルを直接再生する。
 */
export function trackSrc(trackId: string): string {
  return isIos()
    ? `/api/tracks/${trackId}/stream.m3u8`
    : `/api/tracks/${trackId}/file`;
}

export type PlaybackSettings = {
  rate: number;
  preservesPitch: boolean;
};

export function applyPlaybackSettings(target: HTMLAudioElement, settings: PlaybackSettings) {
  target.playbackRate = settings.rate;
  target.defaultPlaybackRate = settings.rate;
  target.preservesPitch = settings.preservesPitch;
  const legacy = target as HTMLAudioElement & { webkitPreservesPitch?: boolean };
  legacy.webkitPreservesPitch = settings.preservesPitch;
}
