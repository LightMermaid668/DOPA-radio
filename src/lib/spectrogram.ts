"use client";

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
};

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
    const res = await fetch(url, { credentials: "include" });
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

  return { hopSec: hop / rate, bands, frames: frameCount, data };
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
