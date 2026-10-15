import { create } from "zustand";

import {
  applyBoostGain,
  applyEqGains,
  EQ_PRESETS,
  ensureEqGraph,
  eqGraphReady,
  MAX_BOOST,
  MIN_BOOST,
} from "@/lib/eq";
import {
  applyPlaybackSettings,
  getAudio,
  isIos,
  maxPlaybackRate,
  prepareFadeIn,
  resetAudioVolume,
  trackSrc,
} from "@/lib/player-audio";

const RATE_KEY = "dopa:playback-rate";
const PITCH_KEY = "dopa:preserves-pitch";
const PITCH_SEMITONES_KEY = "dopa:pitch-semitones";
const DOPA_MODE_KEY = "dopa:dopa-mode";
const CHORUS_ONLY_KEY = "dopa:chorus-only";
const EQ_ENABLED_KEY = "dopa:eq-enabled";
const EQ_PRESET_KEY = "dopa:eq-preset";
const EQ_BASS_KEY = "dopa:eq-bass";
const EQ_MID_KEY = "dopa:eq-mid";
const EQ_TREBLE_KEY = "dopa:eq-treble";
const BOOST_KEY = "dopa:boost-level";

export type PlayerTrack = {
  id: string;
  kind: "upload" | "apple" | "spotify";
  title: string;
  artist: string | null;
  durationSec: number | null;
  artworkUrl: string | null;
  previewUrl?: string | null;
  deepLink?: string | null;
  chorusStartSec?: number | null;
  chorusEndSec?: number | null;
};

export type EqBand = "bass" | "mid" | "treble";

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
  dopaMode: boolean;
  chorusOnly: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  eqBass: number;
  eqMid: number;
  eqTreble: number;
  boostLevel: number;
  playQueue: (tracks: PlayerTrack[], index?: number) => void;
  playQueueShuffled: (tracks: PlayerTrack[]) => void;
  playIndex: (index: number) => void;
  queueAdd: (track: PlayerTrack) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (sec: number) => void;
  setRate: (rate: number) => void;
  setPreservesPitch: (value: boolean) => void;
  setPitchSemitones: (value: number) => void;
  setDopaMode: (value: boolean) => void;
  setChorusOnly: (value: boolean) => void;
  setEqEnabled: (value: boolean) => void;
  applyEqPreset: (preset: string) => void;
  setEqBand: (band: EqBand, value: number) => void;
  setBoostLevel: (value: number) => void;
  shuffleQueue: () => void;
  hydrateSettings: () => void;
  retryCurrent: () => void;
  removeTrack: (trackId: string) => void;
};

let fallbackTrackId: string | null = null;

function formatSemitones(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function persist(key: string, value: string) {
  if (typeof window !== "undefined") localStorage.setItem(key, value);
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
  fade: { fadeIn: boolean; resetVolume: boolean },
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
    if (fade.fadeIn) {
      prepareFadeIn(audio);
    } else if (fade.resetVolume) {
      resetAudioVolume();
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

  // サビだけモード: 通常の頭出し時はサビ開始位置から再生
  const { chorusOnly } = usePlayer.getState();
  const chorusStart =
    chorusOnly &&
    track.kind === "upload" &&
    track.chorusStartSec != null &&
    track.chorusStartSec > 1
      ? track.chorusStartSec
      : null;
  const effectivePosition = position > 3 ? position : (chorusStart ?? position);

  // サビメドレー: 頭出し時はフェードイン、サビ無し曲は音量を必ず戻す
  const chorusPlay = chorusStart != null;
  const fade = {
    fadeIn: chorusPlay && play && position <= 3,
    resetVolume: !chorusPlay,
  };

  if (effectivePitch !== 0) {
    startTrackWithPitch(
      track,
      rate,
      preservesPitch,
      effectivePitch,
      effectivePosition,
      play,
      fade,
    );
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
  if (effectivePosition > 0) {
    const restore = () => {
      audio.removeEventListener("loadedmetadata", restore);
      audio.currentTime = effectivePosition;
    };
    audio.addEventListener("loadedmetadata", restore);
  }
  if (fade.fadeIn) {
    prepareFadeIn(audio);
  } else if (fade.resetVolume) {
    resetAudioVolume();
  }
  if (play) {
    playWithRetry(audio, 0);
  }
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function activateSoundGraph(audio: HTMLAudioElement) {
  void ensureEqGraph(audio).then((ok) => {
    if (!ok) {
      usePlayer.setState({ playbackError: "サウンド設定を初期化できませんでした" });
      return;
    }
    const { eqEnabled, eqBass, eqMid, eqTreble, boostLevel } = usePlayer.getState();
    applyEqGains(
      eqEnabled
        ? { bass: eqBass, mid: eqMid, treble: eqTreble }
        : { bass: 0, mid: 0, treble: 0 },
    );
    applyBoostGain(boostLevel);

    // iOS Safari は MediaElementSource 接続直後に再生が止まる/無音になることがあるため再開させる
    if (usePlayer.getState().isPlaying) {
      void audio.play().catch(() => {});
    }
  });
}

function deactivateSoundGraph() {
  applyEqGains({ bass: 0, mid: 0, treble: 0 });
  applyBoostGain(1);
}

async function fetchRadioTracks(
  seedId: string | null,
  excludeIds: string[],
): Promise<PlayerTrack[]> {
  try {
    const params = new URLSearchParams();
    if (seedId) params.set("seed", seedId);
    if (excludeIds.length > 0) params.set("exclude", excludeIds.slice(-50).join(","));
    const res = await fetch(`/api/radio/next?${params.toString()}`);
    if (!res.ok) return [];
    const body = (await res.json()) as {
      tracks?: Array<{
        id: string;
        title: string;
        artist: string | null;
        durationSec: number | null;
        hasArtwork: boolean;
        chorusStartSec?: number | null;
        chorusEndSec?: number | null;
      }>;
    };
    return (body.tracks ?? []).map((track) => ({
      id: track.id,
      kind: "upload" as const,
      title: track.title,
      artist: track.artist,
      durationSec: track.durationSec,
      artworkUrl: track.hasArtwork ? `/api/tracks/${track.id}/artwork` : null,
      chorusStartSec: track.chorusStartSec ?? null,
      chorusEndSec: track.chorusEndSec ?? null,
    }));
  } catch {
    return [];
  }
}

async function extendWithRadio() {
  const { queue, rate, preservesPitch, pitchSemitones } = usePlayer.getState();
  usePlayer.setState({ playbackNotice: "ドパモード: 次の曲を探しています…" });

  const seed = [...queue].reverse().find((track) => track.kind === "upload") ?? null;
  const additions = await fetchRadioTracks(
    seed?.id ?? null,
    queue.map((track) => track.id),
  );

  if (additions.length === 0) {
    usePlayer.setState({ playbackNotice: null, isPlaying: false, progress: 0 });
    getAudio()?.pause();
    return;
  }

  const latest = usePlayer.getState().queue;
  const startIndex = latest.length;
  usePlayer.setState({
    queue: [...latest, ...additions],
    index: startIndex,
    isPlaying: true,
    progress: 0,
    duration: 0,
    playbackNotice: null,
  });
  startTrack(additions[0], rate, preservesPitch, pitchSemitones);
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
  dopaMode: false,
  chorusOnly: false,
  eqEnabled: false,
  eqPreset: "flat",
  eqBass: 0,
  eqMid: 0,
  eqTreble: 0,
  boostLevel: 1,

  playQueue: (tracks, index = 0) => {
    if (tracks.length === 0) return;
    const target = Math.min(Math.max(index, 0), tracks.length - 1);
    const { rate, preservesPitch, pitchSemitones } = get();
    set({ queue: tracks, index: target, isPlaying: true, progress: 0, duration: 0 });
    startTrack(tracks[target], rate, preservesPitch, pitchSemitones);
  },

  playQueueShuffled: (tracks) => {
    if (tracks.length === 0) return;
    get().playQueue(shuffleArray(tracks), 0);
  },

  playIndex: (index) => {
    const { queue, rate, preservesPitch, pitchSemitones } = get();
    if (index < 0 || index >= queue.length) return;
    set({ index, isPlaying: true, progress: 0, duration: 0 });
    startTrack(queue[index], rate, preservesPitch, pitchSemitones);
  },

  queueAdd: (track) => {
    const { queue } = get();
    if (queue.length === 0) {
      get().playQueue([track], 0);
      return;
    }
    set({ queue: [...queue, track] });
    usePlayer.setState({ playbackNotice: `「${track.title}」をキューに追加しました` });
    setTimeout(() => {
      if (usePlayer.getState().playbackNotice === `「${track.title}」をキューに追加しました`) {
        usePlayer.setState({ playbackNotice: null });
      }
    }, 2500);
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
    const { queue, index, rate, preservesPitch, pitchSemitones, dopaMode } = get();
    const nextIndex = index + 1;

    if (nextIndex < queue.length) {
      set({ index: nextIndex, isPlaying: true, progress: 0, duration: 0 });
      startTrack(queue[nextIndex], rate, preservesPitch, pitchSemitones);
      return;
    }

    if (dopaMode) {
      void extendWithRadio();
      return;
    }

    getAudio()?.pause();
    set({ isPlaying: false, progress: 0 });
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
    persist(RATE_KEY, String(clamped));
    const audio = getAudio();
    if (audio) {
      applyPlaybackSettings(audio, { rate: clamped, preservesPitch: get().preservesPitch });
    }
    set({ rate: clamped });
  },

  setPreservesPitch: (value) => {
    persist(PITCH_KEY, String(value));
    const audio = getAudio();
    if (audio) {
      applyPlaybackSettings(audio, { rate: get().rate, preservesPitch: value });
    }
    set({ preservesPitch: value });
  },

  setPitchSemitones: (value) => {
    const clamped = Math.max(-12, Math.min(12, Math.round(value)));
    persist(PITCH_SEMITONES_KEY, String(clamped));
    set({ pitchSemitones: clamped });

    const audio = getAudio();
    const { queue, index, isPlaying, rate, preservesPitch } = get();
    const track = queue[index];
    if (!track || !audio) return;

    const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    startTrack(track, rate, preservesPitch, clamped, { position, play: isPlaying });
  },

  setDopaMode: (value) => {
    persist(DOPA_MODE_KEY, String(value));
    set({ dopaMode: value });
    // ドパモードON時は「サビだけ」も自動で有効化（サビメドレー体験）
    if (value && !get().chorusOnly) {
      persist(CHORUS_ONLY_KEY, "true");
      set({ chorusOnly: true });
    }
  },

  setChorusOnly: (value) => {
    persist(CHORUS_ONLY_KEY, String(value));
    set({ chorusOnly: value });
    if (!value) {
      resetAudioVolume();
    }
  },

  setEqEnabled: (value) => {
    persist(EQ_ENABLED_KEY, String(value));
    set({ eqEnabled: value });
    const audio = getAudio();
    if (!audio) return;
    const needsGraph = value || get().boostLevel > MIN_BOOST;
    if (needsGraph) {
      activateSoundGraph(audio);
    } else {
      deactivateSoundGraph();
    }
  },

  setBoostLevel: (value) => {
    const clamped = Math.max(
      MIN_BOOST,
      Math.min(MAX_BOOST, Math.round(value * 10) / 10),
    );
    persist(BOOST_KEY, String(clamped));
    set({ boostLevel: clamped });
    const audio = getAudio();
    if (!audio) return;
    const needsGraph = clamped > MIN_BOOST || get().eqEnabled;
    if (needsGraph) {
      if (eqGraphReady()) {
        applyBoostGain(clamped);
      } else {
        activateSoundGraph(audio);
      }
    } else {
      deactivateSoundGraph();
    }
  },

  shuffleQueue: () => {
    const { queue, index } = get();
    if (queue.length < 2) return;
    const current = queue[index];
    const rest = shuffleArray(queue.filter((_, position) => position !== index));
    set({ queue: [current, ...rest], index: 0 });
  },

  applyEqPreset: (preset) => {
    const gains = EQ_PRESETS[preset];
    if (!gains) return;
    persist(EQ_PRESET_KEY, preset);
    persist(EQ_BASS_KEY, String(gains.bass));
    persist(EQ_MID_KEY, String(gains.mid));
    persist(EQ_TREBLE_KEY, String(gains.treble));
    set({
      eqPreset: preset,
      eqBass: gains.bass,
      eqMid: gains.mid,
      eqTreble: gains.treble,
    });
    if (get().eqEnabled) {
      applyEqGains(gains);
    }
  },

  setEqBand: (band, value) => {
    const clamped = Math.max(-15, Math.min(15, Math.round(value)));
    const key = band === "bass" ? EQ_BASS_KEY : band === "mid" ? EQ_MID_KEY : EQ_TREBLE_KEY;
    persist(key, String(clamped));
    persist(EQ_PRESET_KEY, "custom");
    const patch =
      band === "bass"
        ? { eqBass: clamped }
        : band === "mid"
          ? { eqMid: clamped }
          : { eqTreble: clamped };
    set({ ...patch, eqPreset: "custom" });
    if (get().eqEnabled) {
      const { eqBass, eqMid, eqTreble } = get();
      applyEqGains({ bass: eqBass, mid: eqMid, treble: eqTreble });
    }
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
    const dopaMode = localStorage.getItem(DOPA_MODE_KEY) === "true";
    const chorusOnly = localStorage.getItem(CHORUS_ONLY_KEY) === "true";
    const eqEnabled = localStorage.getItem(EQ_ENABLED_KEY) === "true";
    const eqPreset = localStorage.getItem(EQ_PRESET_KEY) ?? "flat";
    const eqBass = Number(localStorage.getItem(EQ_BASS_KEY) ?? "0") || 0;
    const eqMid = Number(localStorage.getItem(EQ_MID_KEY) ?? "0") || 0;
    const eqTreble = Number(localStorage.getItem(EQ_TREBLE_KEY) ?? "0") || 0;
    const storedBoost = Number(localStorage.getItem(BOOST_KEY) ?? "1");
    const boostLevel = Number.isFinite(storedBoost)
      ? Math.max(MIN_BOOST, Math.min(MAX_BOOST, storedBoost))
      : 1;

    set({
      rate,
      preservesPitch,
      pitchSemitones,
      dopaMode,
      chorusOnly,
      eqEnabled,
      eqPreset,
      eqBass,
      eqMid,
      eqTreble,
      boostLevel,
    });

    const audio = getAudio();
    if (audio) {
      applyPlaybackSettings(audio, { rate, preservesPitch });
      const needsGraph = eqEnabled || boostLevel > MIN_BOOST;
      if (needsGraph && typeof document !== "undefined") {
        // グラフ生成は必ずユーザー操作内で行う（自動再生ポリシーで
        // サスペンド状態のAudioContextに接続され無音になるのを防ぐ）。
        const arm = () => {
          const target = getAudio();
          if (target) activateSoundGraph(target);
        };
        document.addEventListener("pointerdown", arm, { once: true });
      }
    }
  },

  retryCurrent: () => {
    const { queue, index, rate, preservesPitch, pitchSemitones } = get();
    const track = queue[index];
    if (!track) return;
    set({ playbackError: null, playbackNotice: null });
    startTrack(track, rate, preservesPitch, pitchSemitones);
  },

  removeTrack: (trackId) => {
    const { queue, index, isPlaying, rate, preservesPitch, pitchSemitones } = get();
    const removeIndex = queue.findIndex((track) => track.id === trackId);
    if (removeIndex < 0) return;

    const nextQueue = queue.filter((_, position) => position !== removeIndex);

    if (nextQueue.length === 0) {
      getAudio()?.pause();
      set({
        queue: [],
        index: 0,
        isPlaying: false,
        progress: 0,
        duration: 0,
        playbackError: null,
        playbackNotice: null,
      });
      return;
    }

    if (removeIndex < index) {
      set({ queue: nextQueue, index: index - 1 });
      return;
    }

    if (removeIndex > index) {
      set({ queue: nextQueue });
      return;
    }

    const nextIndex = Math.min(index, nextQueue.length - 1);
    set({
      queue: nextQueue,
      index: nextIndex,
      progress: 0,
      duration: 0,
      playbackError: null,
      playbackNotice: null,
    });
    startTrack(nextQueue[nextIndex], rate, preservesPitch, pitchSemitones, {
      play: isPlaying,
    });
  },
}));
