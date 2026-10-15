import { create } from "zustand";

import {
  applyPlaybackSettings,
  getAudio,
  isIos,
  maxPlaybackRate,
  trackSrc,
} from "@/lib/player-audio";

const RATE_KEY = "dopa:playback-rate";
const PITCH_KEY = "dopa:preserves-pitch";
const PITCH_SEMITONES_KEY = "dopa:pitch-semitones";

export type PlayerTrack = {
  id: string;
  kind: "upload" | "apple" | "spotify";
  title: string;
  artist: string | null;
  durationSec: number | null;
  artworkUrl: string | null;
  previewUrl?: string | null;
  deepLink?: string | null;
};

type PlayerState = {
  queue: PlayerTrack[];
  index: number;
  isPlaying: boolean;
  progress: number;
  duration: number;
  rate: number;
  preservesPitch: boolean;
  pitchSemitones: number;
  playbackError: string | null;
  playbackNotice: string | null;
  playQueue: (tracks: PlayerTrack[], index?: number) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (sec: number) => void;
  setRate: (rate: number) => void;
  setPreservesPitch: (value: boolean) => void;
  setPitchSemitones: (value: number) => void;
  hydrateSettings: () => void;
  retryCurrent: () => void;
};

let fallbackTrackId: string | null = null;

function formatSemitones(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

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

async function ensurePitchVariant(trackId: string, semitones: number): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`/api/tracks/${trackId}/pitch/${semitones}?check=1`);
      if (res.ok) {
        const data = (await res.json()) as { status?: string };
        if (data.status === "ready") return true;
        if (data.status !== "processing") return false;
      } else {
        return false;
      }
    } catch {
      return false;
    }
    usePlayer.setState({
      playbackNotice: `${formatSemitones(semitones)}半音の音源を生成しています…（初回のみ・数秒）`,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

function startTrackWithPitch(
  track: PlayerTrack,
  rate: number,
  preservesPitch: boolean,
  semitones: number,
  position: number,
  play: boolean,
) {
  void (async () => {
    const audio = getAudio();
    if (!audio) return;
    fallbackTrackId = null;
    usePlayer.setState({
      playbackError: null,
      playbackNotice: `${formatSemitones(semitones)}半音の音源を準備しています…`,
    });

    const ready = await ensurePitchVariant(track.id, semitones);
    if (!ready) {
      usePlayer.setState({
        playbackNotice: null,
        playbackError: "ピッチ音源の生成に失敗しました",
      });
      return;
    }

    usePlayer.setState({ playbackNotice: null });
    audio.src = `/api/tracks/${track.id}/pitch/${semitones}`;
    audio.load();
    applyPlaybackSettings(audio, { rate, preservesPitch });
    if (position > 0) {
      const restore = () => {
        audio.removeEventListener("loadedmetadata", restore);
        audio.currentTime = position;
      };
      audio.addEventListener("loadedmetadata", restore);
    }
    if (play) {
      playWithRetry(audio, 0);
    }
  })();
}

function startTrack(
  track: PlayerTrack,
  rate: number,
  preservesPitch: boolean,
  semitones: number,
  opts?: { position?: number; play?: boolean },
) {
  const play = opts?.play ?? true;
  const position = opts?.position ?? 0;

  if (track.kind === "spotify") {
    getAudio()?.pause();
    usePlayer.setState({
      isPlaying: false,
      playbackError: null,
      playbackNotice: "Spotifyの曲は「アプリで開く」からSpotifyで再生してください",
    });
    return;
  }

  const effectivePitch = track.kind === "upload" ? semitones : 0;

  if (effectivePitch !== 0) {
    startTrackWithPitch(track, rate, preservesPitch, effectivePitch, position, play);
    return;
  }

  const audio = getAudio();
  if (!audio) return;

  let src: string;
  if (track.kind === "apple") {
    if (!track.previewUrl) {
      audio.pause();
      usePlayer.setState({
        isPlaying: false,
        playbackError: null,
        playbackNotice:
          "この曲は試聴できません。「アプリで開く」から Apple Music で再生してください",
      });
      return;
    }
    src = track.previewUrl;
  } else {
    src = trackSrc(track.id);
  }

  fallbackTrackId = null;
  usePlayer.setState({ playbackError: null, playbackNotice: null });
  audio.src = src;
  audio.load();
  applyPlaybackSettings(audio, { rate, preservesPitch });
  if (position > 0) {
    const restore = () => {
      audio.removeEventListener("loadedmetadata", restore);
      audio.currentTime = position;
    };
    audio.addEventListener("loadedmetadata", restore);
  }
  if (play) {
    playWithRetry(audio, 0);
  }
}

export function handleAudioError(audio: HTMLAudioElement) {
  const mediaError = audio.error;
  const { queue, index, rate, preservesPitch, pitchSemitones } = usePlayer.getState();
  const track = queue[index];
  if (!track) return;

  const isFallbackable =
    mediaError &&
    (mediaError.code === mediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
      mediaError.code === mediaError.MEDIA_ERR_DECODE);

  if (
    isFallbackable &&
    pitchSemitones === 0 &&
    track.kind === "upload" &&
    isIos() &&
    fallbackTrackId !== track.id
  ) {
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
  pitchSemitones: 0,
  playbackError: null,
  playbackNotice: null,

  playQueue: (tracks, index = 0) => {
    if (tracks.length === 0) return;
    const target = Math.min(Math.max(index, 0), tracks.length - 1);
    const { rate, preservesPitch, pitchSemitones } = get();
    set({ queue: tracks, index: target, isPlaying: true, progress: 0, duration: 0 });
    startTrack(tracks[target], rate, preservesPitch, pitchSemitones);
  },

  togglePlay: () => {
    const audio = getAudio();
    const { isPlaying, queue, index, rate, preservesPitch, pitchSemitones } = get();
    if (!audio || queue.length === 0) return;
    if (isPlaying) {
      audio.pause();
      set({ isPlaying: false });
      return;
    }
    if (!audio.src) {
      startTrack(queue[index], rate, preservesPitch, pitchSemitones);
    } else {
      playWithRetry(audio, 0);
    }
    set({ isPlaying: true });
  },

  next: () => {
    const { queue, index, rate, preservesPitch, pitchSemitones } = get();
    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      getAudio()?.pause();
      set({ isPlaying: false, progress: 0 });
      return;
    }
    set({ index: nextIndex, isPlaying: true, progress: 0, duration: 0 });
    startTrack(queue[nextIndex], rate, preservesPitch, pitchSemitones);
  },

  prev: () => {
    const audio = getAudio();
    const { queue, index, progress, rate, preservesPitch, pitchSemitones } = get();
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
    startTrack(queue[prevIndex], rate, preservesPitch, pitchSemitones);
  },

  seekTo: (sec) => {
    const audio = getAudio();
    if (audio && Number.isFinite(sec)) {
      audio.currentTime = sec;
    }
    set({ progress: sec });
  },

  setRate: (rate) => {
    const clamped = Math.min(maxPlaybackRate(), Math.max(0.5, rate));
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

  setPitchSemitones: (value) => {
    const clamped = Math.max(-12, Math.min(12, Math.round(value)));
    if (typeof window !== "undefined") {
      localStorage.setItem(PITCH_SEMITONES_KEY, String(clamped));
    }
    set({ pitchSemitones: clamped });

    const audio = getAudio();
    const { queue, index, isPlaying, rate, preservesPitch } = get();
    const track = queue[index];
    if (!track || !audio) return;

    const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    startTrack(track, rate, preservesPitch, clamped, { position, play: isPlaying });
  },

  hydrateSettings: () => {
    if (typeof window === "undefined") return;
    const storedRate = Number(localStorage.getItem(RATE_KEY) ?? "1");
    const rate = Number.isFinite(storedRate)
      ? Math.min(maxPlaybackRate(), Math.max(0.5, storedRate))
      : 1;
    const preservesPitch = localStorage.getItem(PITCH_KEY) !== "false";
    const storedPitch = Number(localStorage.getItem(PITCH_SEMITONES_KEY) ?? "0");
    const pitchSemitones = Number.isFinite(storedPitch)
      ? Math.max(-12, Math.min(12, Math.round(storedPitch)))
      : 0;
    set({ rate, preservesPitch, pitchSemitones });
    const audio = getAudio();
    if (audio) {
      applyPlaybackSettings(audio, { rate, preservesPitch });
    }
  },

  retryCurrent: () => {
    const { queue, index, rate, preservesPitch, pitchSemitones } = get();
    const track = queue[index];
    if (!track) return;
    set({ playbackError: null, playbackNotice: null });
    startTrack(track, rate, preservesPitch, pitchSemitones);
  },
}));
