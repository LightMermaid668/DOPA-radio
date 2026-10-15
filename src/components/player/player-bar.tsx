"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Gauge,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Radio,
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
  maxPlaybackRate,
  resetAudioVolume,
} from "@/lib/player-audio";
import { ensureCaptureAnalyser, eqGraphReady, getBassEnergy } from "@/lib/eq";
import { cn } from "@/lib/utils";
import { handleAudioError, usePlayer, type EqBand } from "@/stores/player";

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

export function PlayerBar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chorusGuardRef = useRef<string | null>(null);
  const fadeOutKeyRef = useRef<string | null>(null);
  const soundPopoverRef = useRef<HTMLDivElement>(null);
  const speedPopoverRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<"speed" | "sound" | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);

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

  useEffect(() => {
    const container = containerRef.current;
    const audio = getAudio();
    if (container && audio && audio.parentElement !== container) {
      container.appendChild(audio);
    }
    hydrateSettings();
  }, [hydrateSettings]);

  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;

    const handleTime = () => {
      const state = usePlayer.getState();
      const current = state.queue[state.index];

      if (
        state.chorusOnly &&
        current?.kind === "upload" &&
        current.chorusEndSec != null &&
        current.chorusEndSec - (current.chorusStartSec ?? 0) >= 5
      ) {
        const key = `${current.id}:${state.index}:${state.queue.length}`;
        const remaining = current.chorusEndSec - audio.currentTime;

        // サビ終端の0.85秒前からフェードアウト
        if (state.isPlaying && !audio.paused && remaining <= 0.85 && remaining > 0.05) {
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
        if (state.isPlaying && !audio.paused && remaining <= 0.08) {
          if (chorusGuardRef.current !== key) {
            chorusGuardRef.current = key;
            state.next();
            return;
          }
        }
      }

      usePlayer.setState({ progress: audio.currentTime, duration: audio.duration || 0 });
    };
    const handlePlay = () => {
      applyPlaybackSettings(audio, {
        rate: usePlayer.getState().rate,
        preservesPitch: usePlayer.getState().preservesPitch,
      });
      usePlayer.setState({ isPlaying: true });
    };
    const handlePause = () => usePlayer.setState({ isPlaying: false });
    const handleEnded = () => usePlayer.getState().next();
    const handleLoaded = () =>
      applyPlaybackSettings(audio, {
        rate: usePlayer.getState().rate,
        preservesPitch: usePlayer.getState().preservesPitch,
      });
    const handleError = () => handleAudioError(audio);

    audio.addEventListener("timeupdate", handleTime);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("loadedmetadata", handleLoaded);
    audio.addEventListener("error", handleError);
    return () => {
      audio.removeEventListener("timeupdate", handleTime);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("loadedmetadata", handleLoaded);
      audio.removeEventListener("error", handleError);
    };
  }, []);

  // リアル波形ライン（横一直線ベース）
  // captureStream/EQグラフで実際の音を解析し、音量に応じて虹色の線が波打つ。無音時は一直線。
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!track) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const COLUMNS = 128;
    const levels = new Float32Array(COLUMNS);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = canvas.getContext("2d");
    let raf = 0;
    let bassEnv = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();
    window.addEventListener("resize", resize);

    const drawFrame = (time: number, speed: number, playing: boolean) => {
      if (!context) return;
      const width = canvas.width;
      const height = canvas.height;
      const mid = height / 2;
      context.clearRect(0, 0, width, height);

      // 低音（ベース）エネルギーを取得。実解析が無い場合は疑似キックで駆動
      let bassTarget = 0;
      if (playing) {
        const real = getBassEnergy();
        if (real !== null) {
          bassTarget = real;
        } else {
          const kick = Math.max(0, Math.sin(time * speed * Math.PI * 2 * 2.1));
          const off = Math.max(
            0,
            Math.sin(time * speed * Math.PI * 2 * 4.2 + 1.3),
          );
          bassTarget =
            0.14 + 0.62 * Math.pow(kick, 3) + 0.14 * Math.pow(off, 4);
        }
      }

      // 速いアタック・緩いリリースで「ドパドパ」感を強調
      bassEnv += (bassTarget - bassEnv) * (bassTarget > bassEnv ? 0.6 : 0.12);
      const amp = Math.min(1, bassEnv * 2.6);

      for (let i = 0; i < COLUMNS; i++) {
        let target = 0;
        if (playing && amp > 0.001) {
          const phase = i / COLUMNS;
          // ライン全体が低音に合わせて激しく上下し、さざ波が走る
          target =
            (Math.sin(phase * Math.PI * 2 * 1.6 + time * speed * 2.6) * 0.55 +
              Math.sin(phase * Math.PI * 2 * 4.2 - time * speed * 4.0) * 0.3 +
              Math.sin(phase * Math.PI * 2 * 8.5 + time * speed * 6.5) * 0.15) *
            amp *
            2.1;
        }

        target = Math.max(-1, Math.min(1, target));
        levels[i] +=
          (target - levels[i]) *
          (Math.abs(target) > Math.abs(levels[i]) ? 0.6 : 0.22);
      }

      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#ff5f6d");
      gradient.addColorStop(0.18, "#ff9f43");
      gradient.addColorStop(0.36, "#f7e463");
      gradient.addColorStop(0.54, "#4ade80");
      gradient.addColorStop(0.72, "#38bdf8");
      gradient.addColorStop(0.88, "#a78bfa");
      gradient.addColorStop(1, "#f472b6");

      context.beginPath();
      const step = width / (COLUMNS - 1);
      for (let i = 0; i < COLUMNS; i++) {
        const x = i * step;
        const y = mid - levels[i] * height * 0.46;
        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      context.strokeStyle = gradient;
      context.lineWidth = Math.max(1.5, height * 0.16) * (1 + amp * 0.9);
      context.lineJoin = "round";
      context.lineCap = "round";
      context.shadowColor = "rgba(232, 121, 249, 0.6)";
      context.shadowBlur = Math.max(4, height * (0.5 + amp * 0.9));
      context.stroke();
      context.shadowBlur = 0;
    };

    if (reduced) {
      drawFrame(0, 1, false);
      return () => window.removeEventListener("resize", resize);
    }

    let captureReady = false;
    let frame = 0;

    const loop = () => {
      const { isPlaying, rate } = usePlayer.getState();
      frame++;

      // captureStream による実解析を試行（対応ブラウザなら常に本物の波形）
      // ※ EQ/音量ブーストのグラフがある場合は captureStream を作らない
      //    （同じ要素に MediaElementSource と captureStream を併用すると無音になるブラウザがある）
      if (
        !captureReady &&
        isPlaying &&
        !eqGraphReady() &&
        (frame === 1 || frame % 120 === 0)
      ) {
        const audio = getAudio();
        if (audio) captureReady = ensureCaptureAnalyser(audio);
      }

      const time = performance.now() / 1000;
      drawFrame(time, rate || 1, isPlaying);
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
        style={{ height: "calc(8rem + env(safe-area-inset-bottom))" }}
      />
      <div
        className="animate-slide-up fixed inset-x-0 bottom-0 z-50 border-t border-dopa-800 bg-dopa-900/95 backdrop-blur"
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          viewTransitionName: "player-bar",
        }}
      >
        <canvas ref={canvasRef} className="h-5 w-full" aria-hidden />
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
                className="bg-rainbow flex size-10 items-center justify-center rounded-full text-dopa-950 hover:brightness-110"
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
            <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
              <h2 className="text-sm font-bold">再生キュー（{queue.length}曲）</h2>
              <div className="flex items-center gap-1">
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
                  onClick={() => setQueueOpen(false)}
                  className="flex size-8 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800"
                  aria-label="閉じる"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {dopaMode || chorusOnly ? (
              <p className="px-5 pb-2 text-[11px] text-zinc-500">
                {dopaMode ? "キューが終わると似てる曲を自動追加。" : ""}
                {chorusOnly ? "サビ範囲が設定された曲はサビの部分だけ再生します。" : ""}
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
