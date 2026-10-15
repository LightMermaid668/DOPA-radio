"use client";

let audio: HTMLAudioElement | null = null;
let hlsSupported: boolean | null = null;

export function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

export function supportsNativeHls(): boolean {
  if (typeof document === "undefined") return false;
  if (hlsSupported === null) {
    const probe = document.createElement("audio");
    hlsSupported = probe.canPlayType("application/vnd.apple.mpegurl") !== "";
  }
  return hlsSupported;
}

export function trackSrc(trackId: string): string {
  return supportsNativeHls()
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
