"use client";

/* eslint-disable @next/next/no-img-element */

import { Gauge, Loader2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { applyPlaybackSettings, getAudio, maxPlaybackRate } from "@/lib/player-audio";
import { cn } from "@/lib/utils";
import { handleAudioError, usePlayer } from "@/stores/player";

const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
const PITCH_OPTIONS = Array.from({ length: 25 }, (_, index) => index - 12);

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
  const playbackNotice = usePlayer((s) => s.playbackNotice);
  const pitchSemitones = usePlayer((s) => s.pitchSemitones);
  const setPitchSemitones = usePlayer((s) => s.setPitchSemitones);
  const retryCurrent = usePlayer((s) => s.retryCurrent);

  const track = queue[index] ?? null;
  const maxRate = maxPlaybackRate();

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
          <div
            aria-hidden
            style={{ height: "calc(7rem + env(safe-area-inset-bottom))" }}
          />
          <div
            className="animate-slide-up fixed inset-x-0 bottom-0 z-50 border-t border-dopa-800 bg-dopa-900/95 backdrop-blur"
            style={{
              paddingBottom: "env(safe-area-inset-bottom)",
              viewTransitionName: "player-bar",
            }}
          >
            <div className="bg-rainbow h-0.5 w-full" aria-hidden />
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

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setSpeedOpen((v) => !v)}
                className={cn(
                  "flex h-8 items-center gap-1 rounded-full border border-dopa-700 px-2.5 text-xs font-semibold",
                  rate === 1 && pitchSemitones === 0
                    ? "text-zinc-300"
                    : "border-accent text-accent",
                )}
                aria-label="再生速度"
              >
                <Gauge className="size-3.5" />
                {rate}x
              </button>

              {speedOpen ? (
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

          <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="w-9 text-right">{formatTime(progress)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0)}
              step={0.1}
              value={Math.min(progress, duration || 0)}
              onChange={(e) => seekTo(Number(e.target.value))}
              className="h-1 w-full cursor-pointer accent-fuchsia-500"
              aria-label="シーク"
            />
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
        </>
      ) : null}
    </>
  );
}
