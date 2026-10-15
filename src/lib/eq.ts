"use client";

export type EqGains = {
  bass: number;
  mid: number;
  treble: number;
};

export const EQ_PRESETS: Record<string, EqGains> = {
  flat: { bass: 0, mid: 0, treble: 0 },
  dopa: { bass: 13, mid: -2, treble: 2 },
  mild: { bass: 6, mid: 0, treble: 1 },
  clear: { bass: 1, mid: -1, treble: 6 },
};

export const MIN_BOOST = 1;
export const MAX_BOOST = 3;

let audioContext: AudioContext | null = null;
let graph: {
  bass: BiquadFilterNode;
  mid: BiquadFilterNode;
  treble: BiquadFilterNode;
  boost: GainNode;
  limiter: DynamicsCompressorNode;
} | null = null;
let analyser: AnalyserNode | null = null;

/**
 * Web Audio のサウンドグラフ（EQ + 音量ブースト + リミッター）を構築して AudioContext を再開する。
 * 一度接続した audio 要素は以降すべてこのグラフを通る（EQ OFFでもフラットで素通し）。
 */
export async function ensureEqGraph(audio: HTMLAudioElement): Promise<boolean> {
  try {
    if (!audioContext) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      audioContext = new Ctor();

      const source = audioContext.createMediaElementSource(audio);

      const bass = audioContext.createBiquadFilter();
      bass.type = "lowshelf";
      bass.frequency.value = 200;

      const mid = audioContext.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 1000;
      mid.Q.value = 0.7;

      const treble = audioContext.createBiquadFilter();
      treble.type = "highshelf";
      treble.frequency.value = 4000;

      // 音量ブースト時の音割れを抑える簡易リミッター
      const boost = audioContext.createGain();
      boost.gain.value = 1;

      const limiter = audioContext.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;

      // 虹色ラインを音に反応させるためのアナライザー
      const analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 512;
      analyserNode.smoothingTimeConstant = 0.75;

      source.connect(bass);
      bass.connect(mid);
      mid.connect(treble);
      treble.connect(boost);
      boost.connect(analyserNode);
      analyserNode.connect(limiter);
      limiter.connect(audioContext.destination);

      graph = { bass, mid, treble, boost, limiter };
      analyser = analyserNode;
    }
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    // iOS Safari: ジェスチャー外から resume できない場合があるため、次のタップで再開を試みる
    if (audioContext.state !== "running" && typeof document !== "undefined") {
      const resumeOnGesture = () => {
        void audioContext?.resume().catch(() => {});
        document.removeEventListener("pointerdown", resumeOnGesture);
      };
      document.addEventListener("pointerdown", resumeOnGesture);
    }
    return true;
  } catch (error) {
    console.warn("[eq] failed to build audio graph:", error);
    return false;
  }
}

export function applyEqGains(gains: EqGains) {
  if (!audioContext || !graph) return;
  const now = audioContext.currentTime;
  graph.bass.gain.setTargetAtTime(gains.bass, now, 0.04);
  graph.mid.gain.setTargetAtTime(gains.mid, now, 0.04);
  graph.treble.gain.setTargetAtTime(gains.treble, now, 0.04);
}

export function applyBoostGain(level: number) {
  if (!audioContext || !graph) return;
  const clamped = Math.max(MIN_BOOST, Math.min(MAX_BOOST, level));
  graph.boost.gain.setTargetAtTime(clamped, audioContext.currentTime, 0.03);
}

export function eqGraphReady(): boolean {
  return Boolean(audioContext && graph);
}

/* ---- captureStream による「覗き見」解析 ----
 * 音声出力は要素のネイティブ再生のまま（バックグラウンド再生を壊さず）に、
 * captureStream で複製したストリームだけを解析して本物のスペクトルを得る。
 * Chrome / Edge / Firefox / Android Chrome で利用可能（Safariは非対応）。 */

let captureContext: AudioContext | null = null;
let captureAnalyser: AnalyserNode | null = null;

export function ensureCaptureAnalyser(audio: HTMLAudioElement): boolean {
  if (captureAnalyser) return true;
  try {
    const captureFn = (
      audio as HTMLAudioElement & { captureStream?: () => MediaStream }
    ).captureStream;
    if (typeof captureFn !== "function") return false;

    const stream = captureFn.call(audio);
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;

    captureContext = new Ctor();
    const source = captureContext.createMediaStreamSource(stream);
    const analyserNode = captureContext.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.6;
    source.connect(analyserNode);
    // destination には接続しない（音はaudio要素が直接鳴らす）
    void captureContext.resume().catch(() => {});
    captureAnalyser = analyserNode;
    return true;
  } catch {
    return false;
  }
}

let bassBuffer: Uint8Array<ArrayBuffer> | null = null;

/* ---- マイク解析（iOS Safari など、要素から実データが取れない環境用） ---- */

let micAnalyser: AnalyserNode | null = null;
let micContext: AudioContext | null = null;
let micStream: MediaStream | null = null;

export async function enableMicAnalyser(): Promise<boolean> {
  if (micAnalyser) return true;
  try {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    micContext = new Ctor();
    const source = micContext.createMediaStreamSource(micStream);
    const node = micContext.createAnalyser();
    node.fftSize = 1024;
    node.smoothingTimeConstant = 0.7;
    source.connect(node);
    await micContext.resume().catch(() => {});
    micAnalyser = node;
    return true;
  } catch (error) {
    console.warn("[eq] mic analyser failed:", error);
    return false;
  }
}

export function disableMicAnalyser() {
  if (micStream) {
    for (const track of micStream.getTracks()) track.stop();
  }
  micStream = null;
  if (micContext) {
    void micContext.close().catch(() => {});
  }
  micContext = null;
  micAnalyser = null;
}

export function micAnalyserEnabled(): boolean {
  return Boolean(micAnalyser);
}

function activeAnalyser(): AnalyserNode | null {
  return analyser ?? captureAnalyser ?? micAnalyser;
}

/**
 * 低音成分のエネルギー（0〜1）。実解析が使えない場合は null。
 */
export function getBassEnergy(): number | null {
  const node = activeAnalyser();
  if (!node) return null;
  if (!bassBuffer || bassBuffer.length !== node.frequencyBinCount) {
    bassBuffer = new Uint8Array(node.frequencyBinCount);
  }
  node.getByteFrequencyData(bassBuffer);
  const bins = Math.min(12, bassBuffer.length);
  let sum = 0;
  for (let i = 0; i < bins; i++) {
    sum += bassBuffer[i];
  }
  return sum / (bins * 255);
}

/**
 * 周波数スペクトルを target に書き込む。
 * EQグラフ → captureStream → マイク → どちらも無ければ false（疑似表示にフォールバック）。
 */
export function getSpectrumData(target: Uint8Array<ArrayBuffer>): boolean {
  const node = activeAnalyser();
  if (!node) return false;
  node.getByteFrequencyData(target);
  return true;
}

/**
 * 波形（時間軸）データを target に書き込む。実音量に比例した振幅が得られる。
 * 無音時は中央値128のフラットな配列になる。
 */
export function getWaveformData(target: Uint8Array<ArrayBuffer>): boolean {
  const node = activeAnalyser();
  if (!node) return false;
  node.getByteTimeDomainData(target);
  return true;
}
