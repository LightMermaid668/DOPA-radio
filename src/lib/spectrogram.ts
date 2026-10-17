"use client";

import type { PlayerTrack } from "@/stores/player";

/**
 * 音声ファイルをデコードして事前にスペクトル（FFT）を計算する。
 * 参考サイト「音声ファイルをアップロード」方式と同じ考え方で、
 * マイクは使わず、再生位置に同期してスペクトルを表示するためのデータを作る。
 */

export type Spectrogram = {
  hopSec: number;
  bands: number;
  frames: number;
  data: Uint8Array; // frames * bands（0〜255）
  /** 低域のオンセット（音の立ち上がり）エンベロープ。DJミックスのビート整列に使う */
  onset: Float32Array;
  /** 推定BPM（検出できないときは null） */
  bpm: number | null;
  /** ビート位相（拍の先頭からの秒数） */
  beatPhase: number | null;
  /** ビート検出の確からしさ 0..1 */
  beatConfidence: number;
};

/**
 * スペクトル解析の対象（音声ファイルのURL）を決める。
 * マイクは使わず、再生している音源そのものをデコードして解析する。
 */
export function spectrogramTarget(
  track: PlayerTrack,
  semitones: number,
): { key: string; url: string } | null {
  if (track.localSrc) {
    return { key: `local:${track.localSrc}`, url: track.localSrc };
  }
  if (track.kind === "upload") {
    if (semitones !== 0) {
      return {
        key: `pitch:${track.id}:${semitones}`,
        url: `/api/tracks/${track.id}/pitch/${semitones}`,
      };
    }
    return { key: `track:${track.id}`, url: `/api/tracks/${track.id}/file` };
  }
  if (track.kind === "apple" && track.previewUrl) {
    return { key: `apple:${track.id}`, url: track.previewUrl };
  }
  return null;
}

/** 解析済みスペクトラム（キャッシュ）を取得する */
export function getCachedSpectrogram(key: string): Spectrogram | null {
  return cache.get(key) ?? null;
}

const cache = new Map<string, Spectrogram>();
const MAX_CACHE = 6;

let decodeContext: AudioContext | null = null;

function getDecodeContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!decodeContext) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    decodeContext = new Ctor();
  }
  return decodeContext;
}

export async function loadSpectrogram(
  key: string,
  url: string,
): Promise<Spectrogram | null> {
  const existing = cache.get(key);
  if (existing) return existing;
  try {
    const res = await fetch(url, {
      // ローカルファイル（dopa-local://）は資格情報なしで取得する
      credentials: url.startsWith("dopa-local:") ? "omit" : "include",
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const context = getDecodeContext();
    if (!context) return null;
    const audioBuffer = await context.decodeAudioData(buffer);
    const spectrogram = await computeSpectrogram(audioBuffer);
    if (spectrogram) {
      cache.set(key, spectrogram);
      if (cache.size > MAX_CACHE) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
    return spectrogram;
  } catch (error) {
    console.warn("[spectrogram] analysis failed:", error);
    return null;
  }
}

async function computeSpectrogram(audioBuffer: AudioBuffer): Promise<Spectrogram | null> {
  const sourceRate = audioBuffer.sampleRate;
  const targetRate = 22050;
  const downsample = Math.max(1, Math.round(sourceRate / targetRate));
  const channels = audioBuffer.numberOfChannels;
  const left = audioBuffer.getChannelData(0);
  const right = channels > 1 ? audioBuffer.getChannelData(1) : null;

  const mixedLength = Math.floor(audioBuffer.length / downsample);
  const mixed = new Float32Array(mixedLength);
  for (let i = 0; i < mixedLength; i++) {
    let sum = 0;
    for (let k = 0; k < downsample; k++) {
      const index = i * downsample + k;
      sum += left[index] + (right ? right[index] : 0);
    }
    mixed[i] = sum / (downsample * (right ? 2 : 1));
  }

  const rate = sourceRate / downsample;
  const fftSize = 1024;
  const hop = 1024; // ≈46ms（22.05kHz時）
  const binCount = fftSize / 2;
  const bands = 128;

  const minHz = 40;
  const maxHz = Math.min(rate / 2 - 100, 16000);
  const edges: number[] = [];
  for (let band = 0; band <= bands; band++) {
    const t = band / bands;
    edges.push(minHz * Math.pow(maxHz / minHz, t));
  }
  const binHz = rate / fftSize;

  const frameCount = Math.max(0, Math.floor((mixedLength - fftSize) / hop) + 1);
  if (frameCount <= 0) return null;

  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const data = new Uint8Array(frameCount * bands);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);

  const CHUNK = 400;
  for (let frame = 0; frame < frameCount; frame++) {
    const offset = frame * hop;
    for (let i = 0; i < fftSize; i++) {
      re[i] = mixed[offset + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);

    for (let band = 0; band < bands; band++) {
      const lowBin = Math.max(1, Math.floor(edges[band] / binHz));
      const highBin = Math.min(
        binCount - 1,
        Math.max(lowBin, Math.ceil(edges[band + 1] / binHz)),
      );
      let maxMagnitude = 0;
      for (let bin = lowBin; bin <= highBin; bin++) {
        const magnitude = Math.hypot(re[bin], im[bin]);
        if (magnitude > maxMagnitude) maxMagnitude = magnitude;
      }
      const db = 20 * Math.log10(maxMagnitude / fftSize + 1e-6);
      data[frame * bands + band] = Math.max(
        0,
        Math.min(255, Math.round((db + 78) * (255 / 78))),
      );
    }

    // メインスレッドをブロックしないように定期的に譲る
    if (frame % CHUNK === CHUNK - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const tempo = estimateTempo(data, frameCount, bands, hop / rate);
  return {
    hopSec: hop / rate,
    bands,
    frames: frameCount,
    data,
    onset: tempo.onset,
    bpm: tempo.bpm,
    beatPhase: tempo.beatPhase,
    beatConfidence: tempo.beatConfidence,
  };
}

/**
 * 低域のオンセット（音の立ち上がり）からBPMとビート位相を推定する。
 * DJミックスのビート同期に使う。検出できない場合は null を返す。
 */
function estimateTempo(
  data: Uint8Array,
  frames: number,
  bands: number,
  hopSec: number,
): {
  bpm: number | null;
  beatPhase: number | null;
  beatConfidence: number;
  onset: Float32Array;
} {
  if (frames < 64) {
    return { bpm: null, beatPhase: null, beatConfidence: 0, onset: new Float32Array(0) };
  }

  const lowBands = Math.min(bands, 24);
  const onset = new Float32Array(frames);
  let previous = 0;
  let total = 0;
  for (let frame = 0; frame < frames; frame++) {
    let energy = 0;
    const base = frame * bands;
    for (let band = 0; band < lowBands; band++) energy += data[base + band];
    onset[frame] = Math.max(0, energy - previous);
    total += onset[frame];
    previous = energy;
  }
  if (total <= 0) return { bpm: null, beatPhase: null, beatConfidence: 0, onset };

  const minLag = Math.max(1, Math.floor(60 / 180 / hopSec));
  const maxLag = Math.min(frames - 1, Math.ceil(60 / 60 / hopSec));
  let bestLag = 0;
  let bestScore = 0;
  let zero = 0;
  for (let frame = 0; frame < frames; frame++) zero += onset[frame] * onset[frame];
  if (zero <= 0) return { bpm: null, beatPhase: null, beatConfidence: 0, onset };

  const scoreAt = (lag: number): number => {
    let score = 0;
    for (let frame = lag; frame < frames; frame++) score += onset[frame] * onset[frame - lag];
    score /= frames - lag;
    const bpm = 60 / (lag * hopSec);
    const weight = bpm >= 80 && bpm <= 160 ? 1.05 : 0.95;
    return score * weight;
  };

  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = scoreAt(lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return { bpm: null, beatPhase: null, beatConfidence: 0, onset };

  // 放物線補間でサブフレーム精度に（BPMのズレを小さくする）
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const sPrev = scoreAt(bestLag - 1);
    const sNext = scoreAt(bestLag + 1);
    const denom = sPrev - 2 * bestScore + sNext;
    if (denom !== 0) {
      const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (sPrev - sNext)) / denom));
      refinedLag = bestLag + delta;
    }
  }

  const confidence = Math.min(1, (bestScore * (frames - bestLag)) / zero);

  // 位相: 補間後のラグ（小数周期）で拍ごとのオンセットを積算する
  // （整数ラグだと周期の端数ぶんドリフトして位相がぼやけるため）
  const maxPhase = Math.max(1, Math.ceil(refinedLag));
  const phaseScoreAt = (value: number): number => {
    const phase = ((value % refinedLag) + refinedLag) % refinedLag;
    let score = 0;
    let k = 0;
    for (;;) {
      const frame = Math.round(phase + k * refinedLag);
      if (frame >= frames) break;
      score += onset[frame];
      k += 1;
    }
    return score;
  };

  let bestPhase = 0;
  let bestPhaseScore = -1;
  for (let phase = 0; phase < maxPhase; phase++) {
    const score = phaseScoreAt(phase);
    if (score > bestPhaseScore) {
      bestPhaseScore = score;
      bestPhase = phase;
    }
  }

  // 位相も放物線補間でサブフレーム精度に
  let refinedPhase = bestPhase;
  if (maxPhase > 1) {
    const prevPhaseScore = phaseScoreAt(bestPhase - 1);
    const nextPhaseScore = phaseScoreAt(bestPhase + 1);
    const denom = prevPhaseScore - 2 * bestPhaseScore + nextPhaseScore;
    if (denom !== 0) {
      refinedPhase =
        bestPhase + Math.max(-0.5, Math.min(0.5, (0.5 * (prevPhaseScore - nextPhaseScore)) / denom));
    }
  }

  const normalizedPhase = ((refinedPhase % refinedLag) + refinedLag) % refinedLag;

  return {
    bpm: 60 / (refinedLag * hopSec),
    beatPhase: normalizedPhase * hopSec,
    beatConfidence: confidence,
    onset,
  };
}

/**
 * DJミックス用: 出ていく曲の終盤と入ってくる曲のオンセット（ビート）を直接照合し、
 * ビートが重なるようにする開始位置のずらし量（コンテンツ秒）を返す。
 * ずらし量は 0〜1拍。はっきりした一致が見つからないときは null。
 */
export function findBeatAlignOffset(
  specA: Spectrogram,
  specB: Spectrogram,
  positionSecA: number,
  positionSecB: number,
  speed: number,
): number | null {
  if (specA.onset.length === 0 || specB.onset.length === 0) return null;
  if (!specB.bpm) return null;
  const hop = specA.hopSec;
  if (hop <= 0 || !Number.isFinite(speed) || speed <= 0) return null;

  const periodBFrames = 60 / specB.bpm / hop;
  if (!Number.isFinite(periodBFrames) || periodBFrames < 2) return null;

  const startA = Math.floor(positionSecA / hop);
  if (startA < 0 || startA + 8 >= specA.onset.length) return null;
  const windowFrames = Math.min(160, specA.onset.length - startA);
  const baseB = positionSecB / hop;

  const lerpB = (x: number): number => {
    const index = Math.floor(x);
    if (index < 0 || index + 1 >= specB.onset.length) return 0;
    const t = x - index;
    return specB.onset[index] * (1 - t) + specB.onset[index + 1] * t;
  };

  let bestShift = -1;
  let bestScore = -1;
  let totalScore = 0;
  let evaluations = 0;
  const maxShift = Math.max(2, Math.ceil(periodBFrames));
  for (let shift = 0; shift <= maxShift; shift += 0.5) {
    let score = 0;
    for (let k = 0; k < windowFrames; k++) {
      score += specA.onset[startA + k] * lerpB(baseB + shift + k * speed);
    }
    totalScore += score;
    evaluations += 1;
    if (score > bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }
  if (bestShift < 0 || evaluations === 0) return null;
  const average = totalScore / evaluations;
  if (average <= 0 || bestScore < average * 1.15) return null;
  return (bestShift % periodBFrames) * hop;
}

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}
