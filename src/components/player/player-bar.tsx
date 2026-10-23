"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Blend,
  Gauge,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Radio,
  Repeat,
  Repeat1,
  Scissors,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  applyPlaybackSettings,
  fadeAudioVolume,
  getAudio,
  getSecondaryAudio,
  maxPlaybackRate,
  resetAudioVolume,
  warmUpSecondaryAudio,
} from "@/lib/player-audio";
import { getDesktop, isDesktopApp } from "@/lib/desktop";
import { loadSpectrogram, spectrogramTarget, type Spectrogram } from "@/lib/spectrogram";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import {
  getOverlapStartPosition,
  handleAudioError,
  noteAppHidden,
  recoverPlayback,
  resumeAfterInterruption,
  usePlayer,
  type EqBand,
} from "@/stores/player";

const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
const PITCH_OPTIONS = Array.from({ length: 25 }, (_, index) => index - 12);

const EQ_PRESET_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "flat", label: "フラット" },
  { key: "dopa", label: "ドパドパ" },
  { key: "mild", label: "低音マイルド" },
  { key: "clear", label: "クリア" },
];

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBoostDb(level: number): string {
  if (level <= 1.001) return "±0dB";
  return `+${(20 * Math.log10(level)).toFixed(1)}dB`;
}

function StudioSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-zinc-400">
        <span>{label}</span>
        <span className={value > min ? "font-semibold text-accent" : undefined}>
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full cursor-pointer accent-fuchsia-500"
        aria-label={label}
      />
    </div>
  );
}

export function PlayerBar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chorusGuardRef = useRef<string | null>(null);
  const fadeOutKeyRef = useRef<string | null>(null);
  const soundPopoverRef = useRef<HTMLDivElement>(null);
  const speedPopoverRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<"speed" | "sound" | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  // SSR結果とクライアントの不一致を避けるため、マウント後に判定する
  const [desktopApp, setDesktopApp] = useState(false);

  useEffect(() => {
    setDesktopApp(isDesktopApp());
  }, []);

  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const progress = usePlayer((s) => s.progress);
  const duration = usePlayer((s) => s.duration);
  const rate = usePlayer((s) => s.rate);
  const preservesPitch = usePlayer((s) => s.preservesPitch);
  const pitchSemitones = usePlayer((s) => s.pitchSemitones);
  const playbackError = usePlayer((s) => s.playbackError);
  const playbackNotice = usePlayer((s) => s.playbackNotice);
  const dopaMode = usePlayer((s) => s.dopaMode);
  const chorusOnly = usePlayer((s) => s.chorusOnly);
  const setChorusOnly = usePlayer((s) => s.setChorusOnly);
  const crossfade = usePlayer((s) => s.crossfade);
  const setCrossfade = usePlayer((s) => s.setCrossfade);
  const crossfadeLong = usePlayer((s) => s.crossfadeLong);
  const setCrossfadeLong = usePlayer((s) => s.setCrossfadeLong);
  const aiMix = usePlayer((s) => s.aiMix);
  const setAiMix = usePlayer((s) => s.setAiMix);
  const studio = usePlayer((s) => s.studio);
  const setStudio = usePlayer((s) => s.setStudio);
  const repeatMode = usePlayer((s) => s.repeatMode);
  const cycleRepeatMode = usePlayer((s) => s.cycleRepeatMode);
  const eqEnabled = usePlayer((s) => s.eqEnabled);
  const eqPreset = usePlayer((s) => s.eqPreset);
  const eqBass = usePlayer((s) => s.eqBass);
  const eqMid = usePlayer((s) => s.eqMid);
  const eqTreble = usePlayer((s) => s.eqTreble);
  const boostLevel = usePlayer((s) => s.boostLevel);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const seekTo = usePlayer((s) => s.seekTo);
  const setRate = usePlayer((s) => s.setRate);
  const setPreservesPitch = usePlayer((s) => s.setPreservesPitch);
  const setPitchSemitones = usePlayer((s) => s.setPitchSemitones);
  const setDopaMode = usePlayer((s) => s.setDopaMode);
  const setEqEnabled = usePlayer((s) => s.setEqEnabled);
  const applyEqPreset = usePlayer((s) => s.applyEqPreset);
  const setEqBand = usePlayer((s) => s.setEqBand);
  const setBoostLevel = usePlayer((s) => s.setBoostLevel);
  const hydrateSettings = usePlayer((s) => s.hydrateSettings);
  const retryCurrent = usePlayer((s) => s.retryCurrent);

  const track = queue[index] ?? null;
  const maxRate = maxPlaybackRate();
  const soundActive = eqEnabled || boostLevel > 1.001;

  // ポップオーバー（速度/サウンド）は外側をタップしたら閉じる
  useEffect(() => {
    if (!panel) return;
    const activeRef = panel === "sound" ? soundPopoverRef : speedPopoverRef;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && activeRef.current && !activeRef.current.contains(target)) {
        setPanel(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [panel]);

  // スペクトラム解析: 音声ファイルをローカルでデコードして事前にFFTを計算し、
  // 再生位置に同期して表示する（参考サイトの「音声ファイル」解析と同じ方式）。
  // マイクは使用しないため、バックグラウンド再生にも影響しない。
  const spectrogramRef = useRef<Spectrogram | null>(null);
  const spectroStatusRef = useRef<"idle" | "loading" | "ready" | "unavailable">("idle");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!track) return;
    const target = spectrogramTarget(track, pitchSemitones);
    spectrogramRef.current = null;
    if (!target) {
      spectroStatusRef.current = "unavailable";
      return;
    }
    spectroStatusRef.current = "loading";
    let cancelled = false;
    void loadSpectrogram(target.key, target.url).then((spectrogram) => {
      if (cancelled) return;
      spectrogramRef.current = spectrogram;
      spectroStatusRef.current = spectrogram ? "ready" : "unavailable";
      // 次の曲を先読みしておく
      const state = usePlayer.getState();
      const nextTrack = state.queue[state.index + 1];
      if (nextTrack) {
        const nextTarget = spectrogramTarget(nextTrack, state.pitchSemitones);
        if (nextTarget) void loadSpectrogram(nextTarget.key, nextTarget.url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [track, pitchSemitones]);

  useEffect(() => {
    const container = containerRef.current;
    const audio = getAudio();
    const secondary = getSecondaryAudio();
    for (const element of [audio, secondary]) {
      if (container && element && element.parentElement !== container) {
        container.appendChild(element);
      }
    }
    hydrateSettings();
  }, [hydrateSettings]);

  useEffect(() => {
    const audio = getAudio();
    const secondary = getSecondaryAudio();
    const elements = [audio, secondary].filter(
      (element): element is HTMLAudioElement => element !== null,
    );
    if (elements.length === 0) return;

    // クロスフェードでメイン要素が入れ替わるため、現在のメインのイベントのみ処理する
    const isMainEvent = (event: Event) => event.currentTarget === getAudio();

    const handleTime = (event: Event) => {
      if (!isMainEvent(event)) {
        // 先読み要素が予定より長く鳴り続けた場合（メイン側の停止・スタール等）は
        // 二重再生を防ぐため先読みを中断する
        const element = event.currentTarget as HTMLAudioElement;
        const state = usePlayer.getState();
        const overrunLimit = state.crossfadeLong || state.aiMix ? 10 : 6;
        if (
          element === getSecondaryAudio() &&
          element.currentTime - getOverlapStartPosition() > overrunLimit
        ) {
          usePlayer.getState().cancelPreload();
        }
        return;
      }
      const element = event.currentTarget as HTMLAudioElement;
      const state = usePlayer.getState();
      const current = state.queue[state.index];

      if (
        state.chorusOnly &&
        current?.kind === "upload" &&
        current.chorusEndSec != null &&
        current.chorusEndSec - (current.chorusStartSec ?? 0) >= 5
      ) {
        const key = `${current.id}:${state.index}:${state.queue.length}`;
        const remaining = current.chorusEndSec - element.currentTime;

        // サビ終端の0.85秒前からフェードアウト
        if (state.isPlaying && !element.paused && remaining <= 0.85 && remaining > 0.05) {
          if (fadeOutKeyRef.current !== key) {
            fadeOutKeyRef.current = key;
            void fadeAudioVolume(0, Math.max(150, (remaining - 0.05) * 1000));
          }
        } else if (remaining > 1.2 && fadeOutKeyRef.current === key) {
          // 巻き戻した場合はフェードをやり直せるよう音量を戻す
          fadeOutKeyRef.current = null;
          resetAudioVolume();
        }

        // サビ終端に達したら次の曲へ（次の曲はフェードインで開始）
        if (state.isPlaying && !element.paused && remaining <= 0.08) {
          if (chorusGuardRef.current !== key) {
            chorusGuardRef.current = key;
            state.advanceToNext();
            return;
          }
        }
        // 巻き戻した場合はガードを解除して再度自動送りできるようにする
        if (remaining > 1.2 && chorusGuardRef.current === key) {
          chorusGuardRef.current = null;
        }
      }

      usePlayer.setState({
        progress: element.currentTime,
        duration: element.duration || 0,
      });
      // クロスフェード（次曲の先読み再生）とドパモード補充の判定
      state.maybeCrossfade(element.currentTime, element.duration || 0);
    };
    const handlePlay = (event: Event) => {
      if (!isMainEvent(event)) return;
      const element = event.currentTarget as HTMLAudioElement;
      applyPlaybackSettings(element, {
        rate: usePlayer.getState().rate,
        preservesPitch: usePlayer.getState().preservesPitch,
      });
      usePlayer.setState({ isPlaying: true });
    };
    const handlePause = (event: Event) => {
      if (!isMainEvent(event)) return;
      // バックグラウンド移行による停止なら「復帰時に再開」の対象にする
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        noteAppHidden();
      }
      // ロック画面・イヤホン操作などの一時停止でも先読みを止める（鳴り続け防止）
      usePlayer.getState().cancelPreload();
      usePlayer.setState({ isPlaying: false });
    };
    const handleEnded = (event: Event) => {
      if (!isMainEvent(event)) {
        // 先読み中の次曲が先に終わってしまった場合（超短い曲など）は昇格して進める
        const element = event.currentTarget as HTMLAudioElement;
        if (element === getSecondaryAudio() && usePlayer.getState().isPlaying) {
          usePlayer.getState().advanceToNext();
        }
        return;
      }
      usePlayer.getState().advanceToNext();
    };
    const handleLoaded = (event: Event) => {
      if (!isMainEvent(event)) return;
      const element = event.currentTarget as HTMLAudioElement;
      applyPlaybackSettings(element, {
        rate: usePlayer.getState().rate,
        preservesPitch: usePlayer.getState().preservesPitch,
      });
    };
    const handleError = (event: Event) => {
      if (!isMainEvent(event)) return;
      handleAudioError(event.currentTarget as HTMLAudioElement);
    };

    for (const element of elements) {
      element.addEventListener("timeupdate", handleTime);
      element.addEventListener("play", handlePlay);
      element.addEventListener("pause", handlePause);
      element.addEventListener("ended", handleEnded);
      element.addEventListener("loadedmetadata", handleLoaded);
      element.addEventListener("error", handleError);
    }

    // iOS: ユーザー操作中に2つ目の要素を無音でウォームアップ（先読み再生の許可を得る）
    const handlePointerDown = () => {
      warmUpSecondaryAudio();
    };
    document.addEventListener("pointerdown", handlePointerDown);

    // 画面復帰・割り込み後は、再生中なら自動でリカバリする
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        recoverPlayback();
        resumeAfterInterruption();
      } else {
        noteAppHidden();
      }
    };
    const handlePageShow = () => {
      recoverPlayback();
      resumeAfterInterruption();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", recoverPlayback);

    return () => {
      for (const element of elements) {
        element.removeEventListener("timeupdate", handleTime);
        element.removeEventListener("play", handlePlay);
        element.removeEventListener("pause", handlePause);
        element.removeEventListener("ended", handleEnded);
        element.removeEventListener("loadedmetadata", handleLoaded);
        element.removeEventListener("error", handleError);
      }
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", recoverPlayback);
    };
  }, []);

  // リアル・スペクトラムアナライザー（バー型 + ピークホールド）
  // 事前解析したスペクトルを再生位置に同期して描画する。
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!track) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const MAX_COLUMNS = 96;
    const levels = new Float32Array(MAX_COLUMNS);
    const peaks = new Float32Array(MAX_COLUMNS);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = canvas.getContext("2d");
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();
    window.addEventListener("resize", resize);

    const drawFrame = (currentTime: number, speed: number) => {
      if (!context) return;
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);

      // 画面幅に合わせてバー本数を決定（バー幅3〜5px程度）
      const columns = Math.max(40, Math.min(MAX_COLUMNS, Math.floor(width / 4)));
      const barWidth = width / columns;
      const gap = Math.max(1, barWidth * 0.28);
      const spectrogram = spectrogramRef.current;

      if (spectrogram) {
        // 再生位置に対応する解析フレームを表示（一時停止中はその場で静止）
        const frameIndex = Math.max(
          0,
          Math.min(spectrogram.frames - 1, Math.round(currentTime / spectrogram.hopSec)),
        );
        const base = frameIndex * spectrogram.bands;
        for (let i = 0; i < columns; i++) {
          const norm = i / (columns - 1);
          const band = Math.min(
            spectrogram.bands - 1,
            Math.round(norm * (spectrogram.bands - 1)),
          );
          const value = spectrogram.data[base + band] / 255;
          const target = Math.max(0, Math.min(1, value * (1.25 - norm * 0.35)));
          // 速いアタック・緩いリリース
          levels[i] += (target - levels[i]) * (target > levels[i] ? 0.6 : 0.35);
          // ピークホールド（ゆっくり落ちる白いキャップ）
          if (levels[i] >= peaks[i]) {
            peaks[i] = levels[i];
          } else {
            peaks[i] = Math.max(levels[i], peaks[i] - 0.012 * (1 + speed * 0.5));
          }
        }
      } else {
        // 解析データが無い/準備中はなだらかに消す
        for (let i = 0; i < columns; i++) {
          levels[i] += (0 - levels[i]) * 0.12;
          if (levels[i] >= peaks[i]) {
            peaks[i] = levels[i];
          } else {
            peaks[i] = Math.max(levels[i], peaks[i] - 0.02);
          }
        }
        if (spectroStatusRef.current === "loading" && currentTime > 0) {
          context.fillStyle = "rgba(255, 255, 255, 0.3)";
          context.font = `${Math.max(8, Math.round(height * 0.38))}px -apple-system, sans-serif`;
          context.fillText("解析中…", 8, Math.round(height * 0.68));
        }
      }

      // 縦方向のレインボーグラデーション（アナライザー定番配色）
      const gradient = context.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, "#3b82f6");
      gradient.addColorStop(0.25, "#22d3ee");
      gradient.addColorStop(0.5, "#4ade80");
      gradient.addColorStop(0.75, "#f7e463");
      gradient.addColorStop(1, "#fb7185");

      // バー
      context.fillStyle = gradient;
      for (let i = 0; i < columns; i++) {
        const barHeight = levels[i] * height * 0.94;
        if (barHeight < 1) continue;
        context.fillRect(
          i * barWidth + gap / 2,
          height - barHeight,
          barWidth - gap,
          barHeight,
        );
      }

      // ピークキャップ
      context.fillStyle = "rgba(255, 255, 255, 0.85)";
      for (let i = 0; i < columns; i++) {
        if (peaks[i] < 0.02) continue;
        const peakY = height - peaks[i] * height * 0.94;
        context.fillRect(i * barWidth + gap / 2, peakY - 1.5, barWidth - gap, 1.5);
      }
    };

    if (reduced) {
      drawFrame(0, 1);
      return () => window.removeEventListener("resize", resize);
    }

    const loop = () => {
      const { rate } = usePlayer.getState();
      const audio = getAudio();
      drawFrame(audio?.currentTime ?? 0, rate || 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [track]);

  useEffect(() => {
    if (!track || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist ?? "DOPA-radio",
      artwork: track.artworkUrl
        ? [{ src: track.artworkUrl, sizes: "600x600", type: "image/webp" }]
        : [],
    });
    navigator.mediaSession.setActionHandler("play", () => {
      void getAudio()?.play().catch(() => {});
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      getAudio()?.pause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      usePlayer.getState().prev();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      usePlayer.getState().next();
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      const audio = getAudio();
      if (audio && details.seekTime != null) {
        audio.currentTime = details.seekTime;
      }
    });
  }, [track]);

  async function playInAppleMusic() {
    const bridge = getDesktop();
    if (!bridge || !track) return;
    try {
      const result = await bridge.playInAppleMusic({
        title: track.title,
        artist: track.artist,
        deepLink: track.deepLink ?? null,
      });
      if (result.status === "played") {
        showToast("Apple Musicで再生しています", "success");
      } else if (result.status === "opened") {
        showToast("Apple Musicアプリを開きました", "info");
      } else {
        showToast("Apple Musicで再生できませんでした", "error");
      }
    } catch {
      showToast("Apple Musicで再生できませんでした", "error");
    }
  }

  const hostDiv = (
    <div
      ref={containerRef}
      aria-hidden
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    />
  );

  if (!track) {
    return hostDiv;
  }

  return (
    <>
      {hostDiv}
      <div
        aria-hidden
        style={{
          height: "calc(8rem + var(--dopa-tabbar-offset, 0px))",
        }}
      />
      <div
        className="app-player-bar animate-slide-up fixed inset-x-0 z-50 border-t border-dopa-800 bg-dopa-900/95 backdrop-blur"
        style={{
          bottom: "var(--dopa-tabbar-offset, 0px)",
          viewTransitionName: "player-bar",
        }}
      >
        <canvas ref={canvasRef} className="h-6 w-full" aria-hidden />
        <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dopa-800">
              {track.artworkUrl ? (
                <img
                  src={track.artworkUrl}
                  alt=""
                  className="size-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="text-rainbow text-xs font-black">DOPA</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold">{track.title}</p>
                {track.kind !== "upload" ? (
                  <span className="shrink-0 rounded-full bg-dopa-800 px-2 py-0.5 text-[9px] font-bold text-zinc-300">
                    {track.kind === "apple" ? "Apple Music" : "Spotify"}
                    {track.kind === "apple" && track.previewUrl ? "・試聴" : ""}
                  </span>
                ) : null}
                {dopaMode ? (
                  <Radio className="size-3 shrink-0 text-accent" aria-label="ドパモードON" />
                ) : null}
              </div>
              <p className="truncate text-xs text-zinc-400">
                {track.artist ?? "アーティスト不明"}
                {track.deepLink && track.kind !== "upload" ? (
                  <>
                    {" ・ "}
                    <a
                      href={track.deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline underline-offset-2"
                    >
                      アプリで開く
                    </a>
                  </>
                ) : null}
                {desktopApp && track.kind === "apple" ? (
                  <>
                    {" ・ "}
                    <button
                      type="button"
                      onClick={() => void playInAppleMusic()}
                      className="text-accent underline underline-offset-2"
                    >
                      Musicアプリで再生
                    </button>
                  </>
                ) : null}
              </p>
            </div>

            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={prev}
                className="flex size-9 items-center justify-center rounded-full text-zinc-300 hover:bg-dopa-800"
                aria-label="前へ"
              >
                <SkipBack className="size-4" />
              </button>
              <button
                type="button"
                onClick={togglePlay}
                className="bg-rainbow animate-rainbow flex size-10 items-center justify-center rounded-full text-dopa-950 hover:brightness-110"
                aria-label={isPlaying ? "一時停止" : "再生"}
              >
                {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <button
                type="button"
                onClick={next}
                className="flex size-9 items-center justify-center rounded-full text-zinc-300 hover:bg-dopa-800"
                aria-label="次へ"
              >
                <SkipForward className="size-4" />
              </button>
            </div>

            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setQueueOpen(true)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full",
                  dopaMode ? "text-accent" : "text-zinc-300 hover:bg-dopa-800",
                )}
                aria-label="再生キュー"
              >
                <ListMusic className="size-4" />
              </button>

              <div ref={soundPopoverRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setPanel((current) => (current === "sound" ? null : "sound"))}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full",
                    soundActive ? "text-accent" : "text-zinc-300 hover:bg-dopa-800",
                  )}
                  aria-label="サウンド設定"
                >
                  <SlidersHorizontal className="size-4" />
                </button>

                {panel === "sound" ? (
                  <div className="animate-pop absolute right-0 bottom-11 w-64 rounded-xl border border-dopa-700 bg-dopa-900 p-3 shadow-xl">
                    <div className="px-1">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span>音量ブースト</span>
                        <span
                          className={cn(
                            "font-semibold",
                            boostLevel > 1.001 ? "text-accent" : "text-zinc-400",
                          )}
                        >
                          {boostLevel.toFixed(1)}x（{formatBoostDb(boostLevel)}）
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.1}
                        value={boostLevel}
                        onChange={(e) => setBoostLevel(Number(e.target.value))}
                        className="mt-1 w-full cursor-pointer accent-fuchsia-500"
                        aria-label="音量ブースト"
                      />
                    </div>

                    <div className="my-2 h-px bg-dopa-800" />

                    <label className="flex cursor-pointer items-center justify-between px-1 text-xs text-zinc-300">
                      イコライザー
                      <input
                        type="checkbox"
                        checked={eqEnabled}
                        onChange={(e) => setEqEnabled(e.target.checked)}
                        className="accent-fuchsia-500"
                      />
                    </label>

                    <div className="mt-2 grid grid-cols-2 gap-1">
                      {EQ_PRESET_OPTIONS.map((preset) => (
                        <button
                          key={preset.key}
                          type="button"
                          onClick={() => {
                            applyEqPreset(preset.key);
                            if (!usePlayer.getState().eqEnabled) setEqEnabled(true);
                          }}
                          className={cn(
                            "rounded-lg px-2 py-1.5 text-[11px]",
                            eqPreset === preset.key
                              ? "bg-dopa-800 font-semibold text-accent"
                              : "text-zinc-300 hover:bg-dopa-800",
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <div
                      className={cn(
                        "mt-3 flex flex-col gap-2 px-1",
                        !eqEnabled && "pointer-events-none opacity-40",
                      )}
                    >
                      {(
                        [
                          { band: "bass" as EqBand, label: "低音", value: eqBass },
                          { band: "mid" as EqBand, label: "中音", value: eqMid },
                          { band: "treble" as EqBand, label: "高音", value: eqTreble },
                        ] as const
                      ).map((item) => (
                        <div key={item.band}>
                          <div className="flex items-center justify-between text-[11px] text-zinc-400">
                            <span>{item.label}</span>
                            <span>
                              {item.value > 0 ? `+${item.value}` : item.value}dB
                            </span>
                          </div>
                          <input
                            type="range"
                            min={-15}
                            max={15}
                            step={1}
                            value={item.value}
                            onChange={(e) => setEqBand(item.band, Number(e.target.value))}
                            className="w-full cursor-pointer accent-fuchsia-500"
                            aria-label={`${item.label}イコライザー`}
                          />
                        </div>
                      ))}
                    </div>

                    {desktopApp ? (
                      <>
                        <div className="my-2 h-px bg-dopa-800" />
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[10px] font-bold text-zinc-400">
                            スタジオモード
                          </span>
                          <span className="bg-rainbow animate-rainbow rounded-full px-1.5 py-0.5 text-[9px] font-black text-dopa-950">
                            DESKTOP
                          </span>
                        </div>
                        <div className="mt-2 flex flex-col gap-2 px-1">
                          <StudioSlider
                            label="ボーカル除去（カラオケ）"
                            value={studio.vocal}
                            min={0}
                            max={100}
                            step={5}
                            format={(value) => `${value}%`}
                            onChange={(value) => setStudio({ vocal: value })}
                          />
                          <StudioSlider
                            label="低音ブースト+"
                            value={studio.bass}
                            min={0}
                            max={15}
                            step={1}
                            format={(value) => (value > 0 ? `+${value}dB` : "±0dB")}
                            onChange={(value) => setStudio({ bass: value })}
                          />
                          <StudioSlider
                            label="リバーブ"
                            value={studio.reverb}
                            min={0}
                            max={100}
                            step={5}
                            format={(value) => `${value}%`}
                            onChange={(value) => setStudio({ reverb: value })}
                          />
                          <label className="flex cursor-pointer items-center justify-between text-[11px] text-zinc-300">
                            8Dオーディオ（回転サウンド）
                            <input
                              type="checkbox"
                              checked={studio.eightD}
                              onChange={(event) => setStudio({ eightD: event.target.checked })}
                              className="accent-fuchsia-500"
                            />
                          </label>
                          <label className="flex cursor-pointer items-center justify-between text-[11px] text-zinc-300">
                            ロングミックス（6秒クロスフェード）
                            <input
                              type="checkbox"
                              checked={crossfadeLong}
                              onChange={(event) => setCrossfadeLong(event.target.checked)}
                              className="accent-fuchsia-500"
                            />
                          </label>
                          <label className="flex cursor-pointer items-center justify-between text-[11px] text-zinc-300">
                            本格DJミックス（ビート同期＋ベーススワップ）
                            <input
                              type="checkbox"
                              checked={aiMix}
                              onChange={(event) => setAiMix(event.target.checked)}
                              className="accent-fuchsia-500"
                            />
                          </label>
                        </div>
                        <p className="mt-2 px-1 text-[10px] leading-tight text-zinc-500">
                          DJミックスはクロスフェード中にテンポを合わせ（キーロック）、ベースを入れ替えながらイコールパワーで混ぜます（サビだけ中も使用可）。デスクトップアプリ専用です。※モノラル音源はボーカル除去100%で無音になります
                        </p>
                      </>
                    ) : null}

                    <p className="mt-2 px-1 text-[10px] leading-tight text-zinc-500">
                      iPhoneではサウンド設定ON中はバックグラウンド再生が不安定になる場合があります（OFFで通常通り）
                    </p>
                  </div>
                ) : null}
              </div>

              <div ref={speedPopoverRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setPanel((current) => (current === "speed" ? null : "speed"))}
                  className={cn(
                    "flex h-8 items-center gap-1 rounded-full border border-dopa-700 px-2 text-xs font-semibold",
                    rate === 1 && pitchSemitones === 0
                      ? "text-zinc-300"
                      : "border-accent text-accent",
                  )}
                  aria-label="再生速度"
                >
                  <Gauge className="size-3.5" />
                  {rate}x
                </button>

                {panel === "speed" ? (
                  <div className="animate-pop absolute right-0 bottom-11 w-64 rounded-xl border border-dopa-700 bg-dopa-900 p-3 shadow-xl">
                    <div className="px-1">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span>速度</span>
                        <span className="font-semibold text-accent">{rate}x</span>
                      </div>
                      <input
                        type="range"
                        min={0.5}
                        max={maxRate}
                        step={0.05}
                        value={Math.min(rate, maxRate)}
                        onChange={(e) => setRate(Number(e.target.value))}
                        className="mt-1 w-full cursor-pointer accent-fuchsia-500"
                        aria-label="再生速度スライダー"
                      />
                    </div>

                    <div className="mt-2 grid grid-cols-4 gap-1">
                      {RATE_OPTIONS.map((option) => {
                        const disabled = option > maxRate;
                        return (
                          <button
                            key={option}
                            type="button"
                            disabled={disabled}
                            onClick={() => setRate(option)}
                            className={cn(
                              "rounded-lg px-1 py-1 text-center text-[11px]",
                              disabled
                                ? "cursor-not-allowed text-zinc-600 line-through"
                                : option === rate
                                  ? "bg-dopa-800 font-semibold text-accent"
                                  : "text-zinc-300 hover:bg-dopa-800",
                            )}
                          >
                            {option}x
                          </button>
                        );
                      })}
                    </div>
                    {maxRate < 4 ? (
                      <p className="mt-1 px-1 text-[10px] text-zinc-500">
                        この端末では 2.5x 以上は再生できないため無効化しています
                      </p>
                    ) : null}

                    <div className="my-2 h-px bg-dopa-800" />

                    <div className="px-1">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                        <span>ピッチ（音程のみ）</span>
                        <select
                          value={pitchSemitones}
                          onChange={(e) => setPitchSemitones(Number(e.target.value))}
                          className={cn(
                            "h-7 rounded-lg border bg-dopa-950 px-1.5 text-[11px] outline-none focus:border-accent",
                            pitchSemitones === 0
                              ? "border-dopa-700 text-zinc-300"
                              : "border-accent text-accent",
                          )}
                          aria-label="ピッチ選択"
                        >
                          {PITCH_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option > 0 ? `+${option}` : option} 半音
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="mt-1 text-[10px] leading-tight text-zinc-500">
                        初回はサーバーで音源を生成します（数秒・一度生成したら即時）
                      </p>
                    </div>

                    <div className="my-2 h-px bg-dopa-800" />

                    <label className="flex cursor-pointer items-center justify-between px-1 text-xs text-zinc-300">
                      速度変更でも声を変えない
                      <input
                        type="checkbox"
                        checked={preservesPitch}
                        onChange={(e) => setPreservesPitch(e.target.checked)}
                        className="accent-fuchsia-500"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="w-9 text-right">{formatTime(progress)}</span>
            <div className="relative flex-1">
              {track.kind === "upload" &&
              track.chorusStartSec != null &&
              track.chorusEndSec != null &&
              duration > 0 ? (
                <div
                  className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent/40"
                  style={{
                    left: `${(track.chorusStartSec / duration) * 100}%`,
                    width: `${((track.chorusEndSec - track.chorusStartSec) / duration) * 100}%`,
                  }}
                  aria-hidden
                />
              ) : null}
              <input
                type="range"
                min={0}
                max={Math.max(duration, 0)}
                step={0.1}
                value={Math.min(progress, duration || 0)}
                onChange={(e) => seekTo(Number(e.target.value))}
                className="relative h-1 w-full cursor-pointer accent-fuchsia-500"
                aria-label="シーク"
              />
            </div>
            <span className="w-9">{formatTime(duration)}</span>
          </div>

          {playbackNotice ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              <span className="min-w-0 flex-1 truncate">{playbackNotice}</span>
            </div>
          ) : null}

          {playbackError ? (
            <div className="mt-2 flex items-center gap-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              <span className="min-w-0 flex-1 truncate">{playbackError}</span>
              <button
                type="button"
                onClick={retryCurrent}
                className="shrink-0 rounded-full border border-red-400/40 px-2.5 py-0.5 font-semibold text-red-200 hover:bg-red-500/10"
              >
                再試行
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {queueOpen ? (
        <div
          className="animate-fade fixed inset-0 z-[60] bg-black/60"
          onClick={() => setQueueOpen(false)}
        >
          <div
            className="animate-slide-up absolute inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-2xl border-t border-dopa-700 bg-dopa-900"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 px-5 pt-4 pb-2">
              <h2 className="pt-1.5 text-sm font-bold">再生キュー（{queue.length}曲）</h2>
              <div className="flex flex-wrap items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => usePlayer.getState().shuffleQueue()}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-dopa-700 px-3 text-xs font-semibold text-zinc-200 hover:bg-dopa-800"
                >
                  <Shuffle className="size-3.5" />
                  シャッフル
                </button>
                <button
                  type="button"
                  onClick={() => setDopaMode(!dopaMode)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
                    dopaMode
                      ? "border-accent text-accent"
                      : "border-dopa-700 text-zinc-200 hover:bg-dopa-800",
                  )}
                >
                  <Radio className="size-3.5" />
                  ドパモード
                </button>
                <button
                  type="button"
                  onClick={() => setChorusOnly(!chorusOnly)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
                    chorusOnly
                      ? "border-accent text-accent"
                      : "border-dopa-700 text-zinc-200 hover:bg-dopa-800",
                  )}
                >
                  <Scissors className="size-3.5" />
                  サビだけ
                </button>
                <button
                  type="button"
                  onClick={() => setCrossfade(!crossfade)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
                    crossfade
                      ? "border-accent text-accent"
                      : "border-dopa-700 text-zinc-200 hover:bg-dopa-800",
                  )}
                >
                  <Blend className="size-3.5" />
                  クロスフェード
                </button>
                <button
                  type="button"
                  onClick={cycleRepeatMode}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
                    repeatMode !== "off"
                      ? "border-accent text-accent"
                      : "border-dopa-700 text-zinc-200 hover:bg-dopa-800",
                  )}
                  aria-label="リピート設定"
                >
                  {repeatMode === "one" ? (
                    <Repeat1 className="size-3.5" />
                  ) : (
                    <Repeat className="size-3.5" />
                  )}
                  {repeatMode === "off"
                    ? "リピートなし"
                    : repeatMode === "one"
                      ? "1曲リピート"
                      : "全曲リピート"}
                </button>
                <button
                  type="button"
                  onClick={() => setQueueOpen(false)}
                  className="flex size-8 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800"
                  aria-label="閉じる"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {dopaMode || chorusOnly || crossfade || repeatMode !== "off" ? (
              <p className="px-5 pb-2 text-[11px] text-zinc-500">
                {dopaMode ? "キューが終わると似てる曲を自動追加。" : ""}
                {chorusOnly ? "サビ範囲が設定された曲はサビの部分だけ再生します。" : ""}
                {crossfade
                  ? "曲の終わり3秒前から次の曲を重ねて途切れなくつなぎます（サビだけ中も動作）。"
                  : ""}
                {repeatMode === "one"
                  ? "1曲リピート: 曲が終わると同じ曲を最初から再生します。"
                  : repeatMode === "all"
                    ? "全曲リピート: リストの最後まで行ったら先頭へ戻ります。"
                    : ""}
              </p>
            ) : null}

            <ul className="flex-1 overflow-y-auto px-3 pb-4">
              {queue.map((item, position) => (
                <li
                  key={`${item.id}-${position}`}
                  className={cn(
                    "flex items-center rounded-xl",
                    position === index ? "bg-dopa-800" : "hover:bg-dopa-800/60",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      usePlayer.getState().playIndex(position);
                      setQueueOpen(false);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                  >
                    <span className="w-6 shrink-0 text-right text-[10px] text-zinc-500">
                      {position + 1}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-xs",
                        position === index
                          ? "font-bold text-accent"
                          : "text-zinc-200",
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="shrink-0 truncate text-[10px] text-zinc-500">
                      {item.artist ?? ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => usePlayer.getState().removeTrack(item.id)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-dopa-700 hover:text-zinc-200"
                    aria-label="キューから削除"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
