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

      source.connect(bass);
      bass.connect(mid);
      mid.connect(treble);
      treble.connect(boost);
      boost.connect(limiter);
      limiter.connect(audioContext.destination);

      graph = { bass, mid, treble, boost, limiter };
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
