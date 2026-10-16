import { create } from "zustand";

import {
  applyBoostGain,
  applyEqGains,
  attachToEqGraph,
  EQ_PRESETS,
  ensureEqGraph,
  eqGraphReady,
  MAX_BOOST,
  MIN_BOOST,
} from "@/lib/eq";
import {
  applyPlaybackSettings,
  getAudio,
  getSecondaryAudio,
  isCrossfadeSrc,
  isIos,
  maxPlaybackRate,
  prepareFadeIn,
  resetAudioVolume,
  retireAudioElement,
  swapAudioRoles,
  trackSrc,
} from "@/lib/player-audio";

const RATE_KEY = "dopa:playback-rate";
const PITCH_KEY = "dopa:preserves-pitch";
const PITCH_SEMITONES_KEY = "dopa:pitch-semitones";
const DOPA_MODE_KEY = "dopa:dopa-mode";
const CHORUS_ONLY_KEY = "dopa:chorus-only";
const CROSSFADE_KEY = "dopa:crossfade";
const EQ_ENABLED_KEY = "dopa:eq-enabled";
const EQ_PRESET_KEY = "dopa:eq-preset";
const EQ_BASS_KEY = "dopa:eq-bass";
const EQ_MID_KEY = "dopa:eq-mid";
const EQ_TREBLE_KEY = "dopa:eq-treble";
const BOOST_KEY = "dopa:boost-level";

// 次の曲を重ね始める秒数（ワーカーが焼き込む頭フェードインと同長）
const CROSSFADE_SEC = 3;

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
  crossfade: boolean;
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
  advanceToNext: () => void;
  prev: () => void;
  seekTo: (sec: number) => void;
  setRate: (rate: number) => void;
  setPreservesPitch: (value: boolean) => void;
  setPitchSemitones: (value: number) => void;
  setDopaMode: (value: boolean) => void;
  setChorusOnly: (value: boolean) => void;
  setCrossfade: (value: boolean) => void;
  maybeCrossfade: (time: number, duration: number) => void;
  cancelPreload: () => void;
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

// 開始操作ごとのトークン。ピッチ音源の生成待ち中に別の曲/操作が始まったら破棄する
let startToken = 0;

// クロスフェード: 2つ目の要素で先読み再生中の次曲インデックス（nullなら重なりなし）
let overlapNextIndex: number | null = null;

// クロスフェード音源が無かった曲（同じ曲で無限に再試行しない）
let crossfadeFallbackId: string | null = null;

// ドパモードの先読み取得中フラグ
let radioFetching = false;
// 先読みが空振りしたときの再試行クールダウン
let radioCooldownUntil = 0;

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

    // iOS Safari: ユーザー操作外からの play() は NotAllowedError で拒否される。
    // エラー表示せず、次のタップで自動的に再開する（操作の邪魔をしない）
    if (name === "NotAllowedError") {
      armGestureResume();
      return;
    }

    // load() 直後の play() は AbortError / NotSupportedError になることがある。
    // canplay を待って再試行する
    if (attempt < 2 && (name === "AbortError" || name === "NotSupportedError")) {
      const retry = () => {
        audio.removeEventListener("canplay", retry);
        playWithRetry(audio, attempt + 1);
      };
      if (audio.readyState >= 2) {
        retry();
      } else {
        audio.addEventListener("canplay", retry);
      }
      return;
    }

    reportPlayError(error);
  });
}

let gestureResumeArmed = false;

/** 次のユーザー操作（タップ）で再生を再開する（iOSの自動再生制限対策） */
function armGestureResume() {
  if (gestureResumeArmed || typeof document === "undefined") return;
  gestureResumeArmed = true;
  const resume = () => {
    gestureResumeArmed = false;
    if (!usePlayer.getState().isPlaying) return;
    const target = getAudio();
    if (target && target.paused && !target.ended) {
      target.play().catch(() => {});
    }
  };
  document.addEventListener("pointerdown", resume, { once: true });
}

/** 先読み再生（オーバーラップ）を中断して2つ目の要素を止める */
function cancelOverlap() {
  if (overlapNextIndex === null) return;
  overlapNextIndex = null;
  const secondary = getSecondaryAudio();
  if (secondary) {
    retireAudioElement(secondary);
  }
}

/**
 * クロスフェードの切り替え: 先読みで再生済みの次曲要素をメインに昇格する。
 * iOSでは「曲が終わってから play()」が無音になる問題があるが、
 * すでに再生中の要素を昇格するだけなのでバックグラウンドでも途切れない。
 */
function advanceOverlap(): boolean {
  const nextIndex = overlapNextIndex;
  overlapNextIndex = null;
  if (nextIndex === null) return false;

  const { queue, rate, preservesPitch, pitchSemitones } = usePlayer.getState();
  const nextTrack = queue[nextIndex];
  const incoming = getSecondaryAudio();

  if (!nextTrack) {
    if (incoming) {
      retireAudioElement(incoming);
    }
    return false;
  }

  if (!incoming || incoming.error || !incoming.src || incoming.paused) {
    // 先読みが失敗していたら通常の開始に任せる
    if (incoming) {
      retireAudioElement(incoming);
    }
    usePlayer.setState({ index: nextIndex, isPlaying: true, progress: 0, duration: 0 });
    startTrack(nextTrack, rate, preservesPitch, pitchSemitones);
    return true;
  }

  const oldMain = getAudio();
  swapAudioRoles();
  if (oldMain) {
    retireAudioElement(oldMain);
  }
  const newMain = getAudio();
  // EQ使用中なら新しいメイン要素をグラフに接続し直す（音質設定を維持）
  if (newMain && eqGraphReady()) {
    attachToEqGraph(newMain);
  }
  usePlayer.setState({
    index: nextIndex,
    isPlaying: true,
    progress: newMain?.currentTime ?? 0,
    duration: newMain?.duration || 0,
    playbackError: null,
    playbackNotice: null,
  });
  return true;
}

/** ドパモード: キュー残りが少なくなったら先読みで補充しておく（バックグラウンドでも繋がるように） */
async function maybePrefetchRadio() {
  const { dopaMode, queue, index } = usePlayer.getState();
  if (!dopaMode || radioFetching) return;
  if (Date.now() < radioCooldownUntil) return;
  if (index < queue.length - 2) return;

  radioFetching = true;
  try {
    const seed = [...queue].reverse().find((track) => track.kind === "upload") ?? null;
    const additions = await fetchRadioTracks(
      seed?.id ?? null,
      queue.map((track) => track.id),
    );
    if (additions.length === 0) {
      // 追加候補が無い/失敗した場合はしばらく再試行しない
      radioCooldownUntil = Date.now() + 60_000;
      return;
    }
    const latest = usePlayer.getState().queue;
    // 先読み中にキューが変わっていたら破棄
    if (latest !== queue) return;
    usePlayer.setState({ queue: [...latest, ...additions] });
  } finally {
    radioFetching = false;
  }
}

async function ensurePitchVariant(
  trackId: string,
  semitones: number,
  token: number,
): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (token !== startToken) return false;
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
    if (token !== startToken) return false;
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
  token: number,
) {
  void (async () => {
    const audio = getAudio();
    if (!audio) return;
    fallbackTrackId = null;
    usePlayer.setState({
      playbackError: null,
      playbackNotice: `${formatSemitones(semitones)}半音の音源を準備しています…`,
    });

    const ready = await ensurePitchVariant(track.id, semitones, token);
    // 生成待ちの間に別の曲/操作が始まっていたら破棄する（勝手に割り込まない）
    if (token !== startToken) return;
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
    // 生成待ちの間に一時停止されていたら自動再生しない
    if (play && usePlayer.getState().isPlaying) {
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
  const token = ++startToken;
  const play = opts?.play ?? true;
  const position = opts?.position ?? 0;

  // 新しい再生が始まるので先読み（クロスフェード）は中断
  cancelOverlap();

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
      token,
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
    // クロスフェードONならフェードを焼き込んだ音源を使う（無ければエラー時にフォールバック）
    const { crossfade, chorusOnly } = usePlayer.getState();
    src =
      crossfade && !chorusOnly && crossfadeFallbackId !== track.id
        ? `/api/tracks/${track.id}/crossfade`
        : trackSrc(track.id);
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

/** 画面復帰・割り込み後に、再生中なら再生を再開する（iOSのジェスチャー制限にも対応） */
export function recoverPlayback() {
  const { isPlaying } = usePlayer.getState();
  if (!isPlaying) return;
  const main = getAudio();
  if (main && main.paused && !main.ended && main.src && !main.src.includes("silence.wav")) {
    playWithRetry(main, 0);
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

  // クロスフェード音源が無い/壊れている場合は通常音源へフォールバック
  if (
    isFallbackable &&
    pitchSemitones === 0 &&
    track.kind === "upload" &&
    isCrossfadeSrc(audio.src) &&
    crossfadeFallbackId !== track.id
  ) {
    crossfadeFallbackId = track.id;
    const position = audio.currentTime;
    console.warn("[player] crossfade source failed. Falling back to normal source");
    audio.src = trackSrc(track.id);
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
  crossfade: true,
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
      cancelOverlap();
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
    // ユーザー操作の「次へ」は頭出し（先読みは破棄して通常開始）
    cancelOverlap();
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

  advanceToNext: () => {
    // 曲が終わったときの遷移: クロスフェードの先読みが再生中なら要素を昇格
    if (overlapNextIndex !== null && advanceOverlap()) return;
    get().next();
  },

  prev: () => {
    cancelOverlap();
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
    const { duration } = get();
    if (
      overlapNextIndex !== null &&
      (!Number.isFinite(sec) || sec < duration - CROSSFADE_SEC)
    ) {
      cancelOverlap();
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
    } else {
      cancelOverlap();
    }
  },

  setCrossfade: (value) => {
    persist(CROSSFADE_KEY, String(value));
    if (!value) cancelOverlap();
    set({ crossfade: value });
  },

  cancelPreload: () => {
    cancelOverlap();
  },

  maybeCrossfade: (time, duration) => {
    const state = get();
    if (!state.isPlaying) return;
    // ドパモード: キュー残りが少なくなったら先読みで補充しておく
    if (state.dopaMode) void maybePrefetchRadio();
    if (!state.crossfade || state.chorusOnly) return;
    if (overlapNextIndex !== null) return;
    if (!duration || !Number.isFinite(duration)) return;
    if (time < duration - CROSSFADE_SEC) return;

    const { queue, index, rate, preservesPitch } = state;
    const current = queue[index];
    const nextTrack = queue[index + 1];
    if (!current || !nextTrack || current.kind !== "upload") return;

    const main = getAudio();
    if (!main || !isCrossfadeSrc(main.src)) return;

    const secondary = getSecondaryAudio();
    if (!secondary) return;

    const nextSrc =
      nextTrack.kind === "upload"
        ? `/api/tracks/${nextTrack.id}/crossfade`
        : (nextTrack.previewUrl ?? null);
    if (!nextSrc) return;

    overlapNextIndex = index + 1;
    secondary.src = nextSrc;
    secondary.load();
    applyPlaybackSettings(secondary, { rate, preservesPitch });

    const clearOnError = () => {
      secondary.removeEventListener("error", clearOnError);
      if (overlapNextIndex === index + 1) cancelOverlap();
    };
    secondary.addEventListener("error", clearOnError);

    const startSecondary = (attempt: number) => {
      secondary.play().catch((error: unknown) => {
        const name = error instanceof Error ? error.name : "";
        if (overlapNextIndex !== index + 1) return;
        if (attempt < 1 && (name === "AbortError" || name === "NotSupportedError")) {
          const retry = () => {
            secondary.removeEventListener("canplay", retry);
            startSecondary(attempt + 1);
          };
          if (secondary.readyState >= 2) {
            retry();
          } else {
            secondary.addEventListener("canplay", retry);
          }
          return;
        }
        // 自動再生できない環境（バックグラウンド等）では通常の切り替えに任せる
        cancelOverlap();
      });
    };
    startSecondary(0);
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
    cancelOverlap();
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
    const crossfade = localStorage.getItem(CROSSFADE_KEY) !== "false";
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
      crossfade,
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
    cancelOverlap();
    const { queue, index, isPlaying, rate, preservesPitch, pitchSemitones } = get();
    const removeIndex = queue.findIndex((track) => track.id === trackId);
    if (removeIndex < 0) return;

    const nextQueue = queue.filter((_, position) => position !== removeIndex);

    if (nextQueue.length === 0) {
      startToken++;
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
