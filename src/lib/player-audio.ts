"use client";

let audio: HTMLAudioElement | null = null;
let secondaryAudio: HTMLAudioElement | null = null;

function createAudioElement(): HTMLAudioElement {
  const element = new Audio();
  element.preload = "auto";
  // イコライザー/音量ブースト（Web Audio）を後からシームレスに使えるように
  // 最初からCORSモードで取得する（自前配信・Apple試聴とも対応済み）
  element.crossOrigin = "anonymous";
  return element;
}

export function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = createAudioElement();
  }
  return audio;
}

/**
 * クロスフェード/先読み用の2つ目の要素。
 * iOSは「曲が終わってから src を変えて play()」が無音になることがあるため、
 * 終了前に次の曲をこの要素で再生開始し、終了時に役割を入れ替える。
 */
export function getSecondaryAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!secondaryAudio) {
    secondaryAudio = createAudioElement();
  }
  return secondaryAudio;
}

/** メインと2つ目の要素の役割を入れ替える（再生を途切れさせずに次の曲へ） */
export function swapAudioRoles(): void {
  const current = audio;
  audio = secondaryAudio;
  secondaryAudio = current;
}

export function isCrossfadeSrc(src: string): boolean {
  return src.includes("/crossfade");
}

/** ウォームアップ/キープアライブ用の無音ファイル（0.05秒） */
export const SILENT_WAV_SRC = "/silence.wav";

let secondaryWarmed = false;

/**
 * iOS Safari は「ユーザー操作なしで作られた要素・一度も再生していない要素」の
 * play() を拒否することがある。クロスフェード用の2つ目の要素を、
 * タップなどのユーザー操作中に無音で一度再生して許可を得ておく。
 */
export function warmUpSecondaryAudio(): boolean {
  if (secondaryWarmed) return true;
  const secondary = getSecondaryAudio();
  if (!secondary) return false;
  // 本番の先読み再生中は邪魔しない
  if (secondary.src && !secondary.src.includes("silence.wav")) return secondaryWarmed;
  try {
    if (!secondary.src) {
      secondary.src = SILENT_WAV_SRC;
      secondary.load();
    }
    void secondary
      .play()
      .then(() => {
        secondaryWarmed = true;
        // ウォームアップ中に本番の先読み再生が始まっていたら止めない
        const current = getSecondaryAudio();
        if (
          current === secondary &&
          secondary.src.includes("silence.wav") &&
          !secondary.paused
        ) {
          try {
            secondary.pause();
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {
        /* 次の操作で再試行される */
      });
  } catch {
    /* ignore */
  }
  return secondaryWarmed;
}

/**
 * 要素を休止状態にする（再生停止 + 実ストリームの解放）。
 * iOSのキープアライブのため、無音ファイルだけは読み込んだままにする。
 */
export function retireAudioElement(element: HTMLAudioElement) {
  try {
    element.pause();
  } catch {
    /* ignore */
  }
  if (!element.src.includes("silence.wav")) {
    element.src = SILENT_WAV_SRC;
    element.load();
  }
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

const playbackSettings = new WeakMap<HTMLAudioElement, PlaybackSettings>();
const reapplyBound = new WeakSet<HTMLAudioElement>();

function applyPlaybackSettingsNow(target: HTMLAudioElement, settings: PlaybackSettings) {
  // 未対応の値で例外を投げるブラウザがあるため個別に保護する
  try {
    target.playbackRate = settings.rate;
  } catch {
    /* ignore */
  }
  try {
    target.defaultPlaybackRate = settings.rate;
  } catch {
    /* ignore */
  }
  const legacy = target as HTMLAudioElement & { webkitPreservesPitch?: boolean };
  try {
    target.preservesPitch = settings.preservesPitch;
    legacy.webkitPreservesPitch = settings.preservesPitch;
  } catch {
    /* ignore */
  }
}

export function applyPlaybackSettings(target: HTMLAudioElement, settings: PlaybackSettings) {
  playbackSettings.set(target, settings);
  if (!reapplyBound.has(target)) {
    reapplyBound.add(target);
    // iOS Safari は読み込み前に設定した速度/ピッチ保持を破棄することがあるため、
    // メタデータ読み込み・再生開始のタイミングでも再適用する
    const reapply = () => {
      const latest = playbackSettings.get(target);
      if (latest) applyPlaybackSettingsNow(target, latest);
    };
    target.addEventListener("loadedmetadata", reapply);
    target.addEventListener("canplay", reapply);
    target.addEventListener("playing", reapply);
  }
  applyPlaybackSettingsNow(target, settings);
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
