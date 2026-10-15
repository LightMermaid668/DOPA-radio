"use client";

let audio: HTMLAudioElement | null = null;

export function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    // イコライザー/音量ブースト（Web Audio）を後からシームレスに使えるように
    // 最初からCORSモードで取得する（自前配信・Apple試聴とも対応済み）
    audio.crossOrigin = "anonymous";
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
 * 再生速度の上限。
 * iOS (AVPlayer) は 2.5x 以上で再生が止まるため 2.0x まで。
 * それ以外のクライアントは 4.0x まで許可する。
 */
export function maxPlaybackRate(): number {
  return isIos() ? 2 : 4;
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

/* ---- 音量フェード（サビメドレーのフェードイン/アウト用） ---- */

let fadeTimer: number | null = null;

export function cancelVolumeFade() {
  if (fadeTimer !== null) {
    window.clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

/** 現在音量から target（0〜1）へ durationMs かけてランプする */
export function fadeAudioVolume(target: number, durationMs: number): Promise<void> {
  const audio = getAudio();
  if (!audio) return Promise.resolve();
  cancelVolumeFade();

  const startVolume = audio.volume;
  const to = Math.max(0, Math.min(1, target));
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const step = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / Math.max(1, durationMs));
      audio.volume = startVolume + (to - startVolume) * progress;
      if (progress >= 1) {
        cancelVolumeFade();
        resolve();
      }
    };
    fadeTimer = window.setInterval(step, 30);
  });
}

/** フェードを中断して音量を1に戻す */
export function resetAudioVolume() {
  cancelVolumeFade();
  const audio = getAudio();
  if (audio) audio.volume = 1;
}

/** 音量0から再生開始時にフェードインする（playingイベントで開始） */
export function prepareFadeIn(audio: HTMLAudioElement, durationMs = 800) {
  cancelVolumeFade();
  audio.volume = 0;
  const onPlaying = () => {
    audio.removeEventListener("playing", onPlaying);
    void fadeAudioVolume(1, durationMs);
  };
  audio.addEventListener("playing", onPlaying);
}
