import { create } from "zustand";

import { applyPlaybackSettings, getAudio, trackSrc } from "@/lib/player-audio";

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
  playQueue: (tracks: PlayerTrack[], index?: number) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (sec: number) => void;
  setRate: (rate: number) => void;
  setPreservesPitch: (value: boolean) => void;
  hydrateSettings: () => void;
};

function startTrack(track: PlayerTrack, rate: number, preservesPitch: boolean) {
  const audio = getAudio();
  if (!audio) return;
  audio.src = trackSrc(track.id);
  applyPlaybackSettings(audio, { rate, preservesPitch });
  void audio.play().catch(() => {});
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  isPlaying: false,
  progress: 0,
  duration: 0,
  rate: 1,
  preservesPitch: true,

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
      void audio.play().catch(() => {});
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
}));
