"use client";

import { isDesktopApp } from "@/lib/desktop";

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

export type StudioSettings = {
  /** ボーカル除去 0..100 */
  vocal: number;
  /** 低音ブースト+ 0..15 (dB) */
  bass: number;
  /** リバーブ 0..100 */
  reverb: number;
  /** 8Dオーディオ（自動パン） */
  eightD: boolean;
};

export const STUDIO_DEFAULTS: StudioSettings = {
  vocal: 0,
  bass: 0,
  reverb: 0,
  eightD: false,
};

type StudioNodes = {
  bassShelf: BiquadFilterNode;
  dry: GainNode;
  wet: GainNode;
  lfoGain: GainNode;
  rvDry: GainNode;
  rvWet: GainNode;
};

let audioContext: AudioContext | null = null;
let graph: {
  bass: BiquadFilterNode;
  mid: BiquadFilterNode;
  treble: BiquadFilterNode;
  boost: GainNode;
  limiter: DynamicsCompressorNode;
  studio: StudioNodes | null;
} | null = null;

// MediaElementSourceは1要素につき1回だけ作成できるため、接続済み要素を記録する
const connectedElements = new WeakSet<HTMLAudioElement>();

function connectElement(element: HTMLAudioElement): boolean {
  if (!audioContext || !graph) return false;
  if (connectedElements.has(element)) return true;
  try {
    const source = audioContext.createMediaElementSource(element);
    source.connect(graph.bass);
    connectedElements.add(element);
    return true;
  } catch (error) {
    console.warn("[eq] failed to connect element:", error);
    return false;
  }
}

/** クロスフェードでメイン要素が入れ替わったときに、新しい要素をグラフへ接続する */
export function attachToEqGraph(element: HTMLAudioElement): boolean {
  return connectElement(element);
}

/** リバーブ用のインパルス応答（減衰ノイズ）を生成する */
function makeReverbImpulse(context: AudioContext): AudioBuffer {
  const seconds = 2.2;
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const decay = Math.pow(1 - i / length, 2.6);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  return impulse;
}

/**
 * Web Audio のサウンドグラフ（EQ + 音量ブースト + リミッター、
 * デスクトップアプリでは+スタジオモード: ボーカル除去/低音+/リバーブ/8D）を構築する。
 */
export async function ensureEqGraph(audio: HTMLAudioElement): Promise<boolean> {
  try {
    if (!audioContext) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      audioContext = new Ctor();

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

      const boost = audioContext.createGain();
      boost.gain.value = 1;

      const limiter = audioContext.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;

      let studio: StudioNodes | null = null;

      if (isDesktopApp()) {
        // ---- スタジオモード（デスクトップ専用の固定グラフ。各エフェクトはゲインで0=無効） ----
        const studioBass = audioContext.createBiquadFilter();
        studioBass.type = "lowshelf";
        studioBass.frequency.value = 60;
        studioBass.gain.value = 0;

        const dry = audioContext.createGain();
        dry.gain.value = 1;

        const splitter = audioContext.createChannelSplitter(2);
        const invL = audioContext.createGain();
        invL.gain.value = -1;
        const invR = audioContext.createGain();
        invR.gain.value = -1;
        const merger = audioContext.createChannelMerger(2);
        const wet = audioContext.createGain();
        wet.gain.value = 0;
        const bus = audioContext.createGain();

        const panner = audioContext.createStereoPanner();
        const lfo = audioContext.createOscillator();
        lfo.frequency.value = 0.12;
        const lfoGain = audioContext.createGain();
        lfoGain.gain.value = 0;
        lfo.connect(lfoGain);
        lfoGain.connect(panner.pan);
        lfo.start();

        const rvDry = audioContext.createGain();
        rvDry.gain.value = 1;
        const convolver = audioContext.createConvolver();
        convolver.buffer = makeReverbImpulse(audioContext);
        const rvWet = audioContext.createGain();
        rvWet.gain.value = 0;
        const rvBus = audioContext.createGain();

        // treble → studioBass →（ドライ + ボーカル除去ウェット）→ bus
        treble.connect(studioBass);
        studioBass.connect(dry);
        dry.connect(bus);
        // カラオケ方式: 左 = L - R / 右 = R - L（中央のボーカルを打ち消す）
        studioBass.connect(splitter);
        splitter.connect(merger, 0, 0);
        splitter.connect(invR, 1);
        invR.connect(merger, 0, 0);
        splitter.connect(merger, 1, 1);
        splitter.connect(invL, 0);
        invL.connect(merger, 1, 1);
        merger.connect(wet);
        wet.connect(bus);

        // bus → 8Dパン →（リバーブ ドライ/ウェット）→ boost
        bus.connect(panner);
        panner.connect(rvDry);
        rvDry.connect(rvBus);
        panner.connect(convolver);
        convolver.connect(rvWet);
        rvWet.connect(rvBus);
        rvBus.connect(boost);

        studio = { bassShelf: studioBass, dry, wet, lfoGain, rvDry, rvWet };
      } else {
        treble.connect(boost);
      }

      bass.connect(mid);
      mid.connect(treble);
      boost.connect(limiter);
      limiter.connect(audioContext.destination);

      graph = { bass, mid, treble, boost, limiter, studio };
    }
    if (!connectElement(audio)) return false;
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

export function applyStudioSettings(settings: StudioSettings) {
  if (!audioContext || !graph?.studio) return;
  const now = audioContext.currentTime;
  const studio = graph.studio;
  const vocal = Math.max(0, Math.min(100, settings.vocal)) / 100;
  const reverb = Math.max(0, Math.min(100, settings.reverb)) / 100;
  studio.dry.gain.setTargetAtTime(1 - vocal, now, 0.05);
  studio.wet.gain.setTargetAtTime(vocal, now, 0.05);
  studio.bassShelf.gain.setTargetAtTime(Math.max(0, Math.min(15, settings.bass)), now, 0.05);
  studio.rvWet.gain.setTargetAtTime(reverb * 0.9, now, 0.05);
  studio.rvDry.gain.setTargetAtTime(1 - reverb * 0.3, now, 0.05);
  studio.lfoGain.gain.setTargetAtTime(settings.eightD ? 0.85 : 0, now, 0.05);
}

export function eqGraphReady(): boolean {
  return Boolean(audioContext && graph);
}

export function studioGraphReady(): boolean {
  return Boolean(audioContext && graph?.studio);
}
