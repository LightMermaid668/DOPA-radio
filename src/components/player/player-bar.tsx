"use client";

/* eslint-disable @next/next/no-img-element */

import { Gauge, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { applyPlaybackSettings, getAudio } from "@/lib/player-audio";
import { cn } from "@/lib/utils";
import { handleAudioError, usePlayer } from "@/stores/player";

const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlayerBar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [speedOpen, setSpeedOpen] = useState(false);

  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const progress = usePlayer((s) => s.progress);
  const duration = usePlayer((s) => s.duration);
  const rate = usePlayer((s) => s.rate);
  const preservesPitch = usePlayer((s) => s.preservesPitch);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const seekTo = usePlayer((s) => s.seekTo);
  const setRate = usePlayer((s) => s.setRate);
  const setPreservesPitch = usePlayer((s) => s.setPreservesPitch);
  const hydrateSettings = usePlayer((s) => s.hydrateSettings);
  const playbackError = usePlayer((s) => s.playbackError);
  const retryCurrent = usePlayer((s) => s.retryCurrent);

  const track = queue[index] ?? null;

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

    const handleTime = () =>
      usePlayer.setState({ progress: audio.currentTime, duration: audio.duration || 0 });
    const handlePlay = () => {
      // Safari が src 切替時に再生速度/ピッチをリセットする場合があるため再適用
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

  return (
    <>
      {/* iOS Safari は display:none 内のメディアを読み込まないため、サイズ0の絶対配置で保持する */}
      <div
        ref={containerRef}
        aria-hidden
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      />
      {track ? (
        <>
          <div className="h-28" aria-hidden />
          <div className="fixed inset-x-0 bottom-0 z-50 border-t border-dopa-800 bg-dopa-900/95 backdrop-blur">
            <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dopa-800">
              {track.artworkUrl ? (
                <img
                  src={track.artworkUrl}
                  alt=""
                  className="size-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="text-xs text-zinc-500">DOPA</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{track.title}</p>
              <p className="truncate text-xs text-zinc-400">
                {track.artist ?? "アーティスト不明"}
              </p>
            </div>

            <div className="flex items-center gap-1">
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
                className="flex size-10 items-center justify-center rounded-full bg-accent text-dopa-950 hover:bg-accent-strong"
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

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setSpeedOpen((v) => !v)}
                className={cn(
                  "flex h-8 items-center gap-1 rounded-full border border-dopa-700 px-2.5 text-xs font-semibold",
                  rate === 1 ? "text-zinc-300" : "border-accent text-accent",
                )}
                aria-label="再生速度"
              >
                <Gauge className="size-3.5" />
                {rate}x
              </button>

              {speedOpen ? (
                <div className="absolute right-0 bottom-11 w-40 rounded-xl border border-dopa-700 bg-dopa-900 p-2 shadow-xl">
                  <label className="flex cursor-pointer items-center justify-between px-2 py-1.5 text-xs text-zinc-300">
                    ピッチを維持
                    <input
                      type="checkbox"
                      checked={preservesPitch}
                      onChange={(e) => setPreservesPitch(e.target.checked)}
                      className="accent-amber-500"
                    />
                  </label>
                  <div className="my-1 h-px bg-dopa-800" />
                  <div className="max-h-56 overflow-y-auto">
                    {RATE_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setRate(option);
                          setSpeedOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs",
                          option === rate
                            ? "bg-dopa-800 font-semibold text-accent"
                            : "text-zinc-300 hover:bg-dopa-800",
                        )}
                      >
                        {option}x
                        {option === rate ? <span>✓</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="w-9 text-right">{formatTime(progress)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0)}
              step={0.1}
              value={Math.min(progress, duration || 0)}
              onChange={(e) => seekTo(Number(e.target.value))}
              className="h-1 w-full cursor-pointer accent-amber-500"
              aria-label="シーク"
            />
            <span className="w-9">{formatTime(duration)}</span>
          </div>

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
        </>
      ) : null}
    </>
  );
}
