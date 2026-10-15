import { create } from "zustand";

import {
  applyPlaybackSettings,
  getAudio,
  isIos,
  trackSrc,
} from "@/lib/player-audio";

const RATE_KEY = "dopa:playback-rate";
const PITCH_KEY = "dopa:preserves-pitch";

export type PlayerTrack = {
  id: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  artworkUrl: string | null;
};

type PlayerState = {
  queue: PlayerTrack[];
  index: number;
  isPlaying: boolean;
  progress: number;
  duration: number;
  rate: number;
  preservesPitch: boolean;
  playbackError: string | null;
  playQueue: (tracks: PlayerTrack[], index?: number) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (sec: number) => void;
  setRate: (rate: number) => void;
  setPreservesPitch: (value: boolean) => void;
  hydrateSettings: () => void;
  retryCurrent: () => void;
};

let fallbackTrackId: string | null = null;

function reportPlayError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.warn("[player] play() failed:", error);
  usePlayer.setState({ playbackError: `再生を開始できません（${message}）` });
}

function playWithRetry(audio: HTMLAudioElement, attempt: number) {
  audio.play().catch((error: unknown) => {
    const name = error instanceof Error ? error.name : "";
    if (attempt < 1 && (name === "AbortError" || name === "NotSupportedError")) {
      const retry = () => {
        audio.removeEventListener("canplay", retry);
        audio.play().catch((retryError) => reportPlayError(retryError));
      };
      audio.addEventListener("canplay", retry);
      return;
    }
    reportPlayError(error);
  });
}

function startTrack(track: PlayerTrack, rate: number, preservesPitch: boolean) {
  const audio = getAudio();
  if (!audio) return;
  fallbackTrackId = null;
  usePlayer.setState({ playbackError: null });
  audio.src = trackSrc(track.id);
  audio.load();
  applyPlaybackSettings(audio, { rate, preservesPitch });
  playWithRetry(audio, 0);
}

export function handleAudioError(audio: HTMLAudioElement) {
  const mediaError = audio.error;
  const { queue, index, rate, preservesPitch } = usePlayer.getState();
  const track = queue[index];
  if (!track) return;

  const isFallbackable =
    mediaError &&
    (mediaError.code === mediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
      mediaError.code === mediaError.MEDIA_ERR_DECODE);

  if (isFallbackable && isIos() && fallbackTrackId !== track.id) {
    fallbackTrackId = track.id;
    const position = audio.currentTime;
    console.warn(
      `[player] HLS playback failed (code ${mediaError.code}). Falling back to AAC file`,
    );
    audio.src = `/api/tracks/${track.id}/file`;
    audio.load();
    applyPlaybackSettings(audio, { rate, preservesPitch });
    const restore = () => {
      audio.removeEventListener("loadedmetadata", restore);
      if (position > 0) audio.currentTime = position;
    };
    audio.addEventListener("loadedmetadata", restore);
    playWithRetry(audio, 1);
    return;
  }

  console.warn("[player] media error:", mediaError);
  const code = mediaError?.code ?? "?";
  const detail = mediaError?.message || "メディアを読み込めませんでした";
  usePlayer.setState({ playbackError: `再生に失敗しました（code ${code}: ${detail}）` });
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  isPlaying: false,
  progress: 0,
  duration: 0,
  rate: 1,
  preservesPitch: true,
  playbackError: null,

  playQueue: (tracks, index = 0) => {
    if (tracks.length === 0) return;
    const target = Math.min(Math.max(index, 0), tracks.length - 1);
    const { rate, preservesPitch } = get();
    set({ queue: tracks, index: target, isPlaying: true, progress: 0, duration: 0 });
    startTrack(tracks[target], rate, preservesPitch);
  },

  togglePlay: () => {
    const audio = getAudio();
    const { isPlaying, queue, index, rate, preservesPitch } = get();
    if (!audio || queue.length === 0) return;
    if (isPlaying) {
      audio.pause();
      set({ isPlaying: false });
      return;
    }
    if (!audio.src) {
      startTrack(queue[index], rate, preservesPitch);
    } else {
      playWithRetry(audio, 0);
    }
    set({ isPlaying: true });
  },

  next: () => {
    const { queue, index, rate, preservesPitch } = get();
    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      getAudio()?.pause();
      set({ isPlaying: false, progress: 0 });
      return;
    }
    set({ index: nextIndex, isPlaying: true, progress: 0, duration: 0 });
    startTrack(queue[nextIndex], rate, preservesPitch);
  },

  prev: () => {
    const audio = getAudio();
    const { queue, index, progress, rate, preservesPitch } = get();
    if (audio && progress > 3) {
      audio.currentTime = 0;
      set({ progress: 0 });
      return;
    }
    const prevIndex = Math.max(0, index - 1);
    if (prevIndex === index) {
      if (audio) audio.currentTime = 0;
      set({ progress: 0 });
      return;
    }
    set({ index: prevIndex, isPlaying: true, progress: 0, duration: 0 });
    startTrack(queue[prevIndex], rate, preservesPitch);
  },

  seekTo: (sec) => {
    const audio = getAudio();
    if (audio && Number.isFinite(sec)) {
      audio.currentTime = sec;
    }
    set({ progress: sec });
  },

  setRate: (rate) => {
    const clamped = Math.min(4, Math.max(0.5, rate));
    if (typeof window !== "undefined") {
      localStorage.setItem(RATE_KEY, String(clamped));
    }
    const audio = getAudio();
    if (audio) {
      applyPlaybackSettings(audio, { rate: clamped, preservesPitch: get().preservesPitch });
    }
    set({ rate: clamped });
  },

  setPreservesPitch: (value) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(PITCH_KEY, String(value));
    }
    const audio = getAudio();
    if (audio) {
      applyPlaybackSettings(audio, { rate: get().rate, preservesPitch: value });
    }
    set({ preservesPitch: value });
  },

  hydrateSettings: () => {
    if (typeof window === "undefined") return;
    const storedRate = Number(localStorage.getItem(RATE_KEY) ?? "1");
    const rate = Number.isFinite(storedRate) ? Math.min(4, Math.max(0.5, storedRate)) : 1;
    const preservesPitch = localStorage.getItem(PITCH_KEY) !== "false";
    set({ rate, preservesPitch });
    const audio = getAudio();
    if (audio) {
      applyPlaybackSettings(audio, { rate, preservesPitch });
    }
  },

  retryCurrent: () => {
    const { queue, index, rate, preservesPitch } = get();
    const track = queue[index];
    if (!track) return;
    set({ playbackError: null });
    startTrack(track, rate, preservesPitch);
  },
}));
