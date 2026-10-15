import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * 「サビ」を簡易自動検出する。
 * 8kHzモノラルのPCMにして0.5秒ごとのRMSエネルギーを計算し、
 * 最もエネルギーが高い持続区間（20秒窓）をサビ候補として前後に拡張する。
 * 典型的なJ-POPでは「一番盛り上がる部分」≒サビになる。
 */
export async function detectChorus(
  filePath: string,
  durationSec: number,
): Promise<{ start: number; end: number } | null> {
  if (!Number.isFinite(durationSec) || durationSec < 45) return null;

  const result = await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
    { encoding: "buffer", maxBuffer: 80 * 1024 * 1024 },
  );
  const buffer = result.stdout as unknown as Buffer;
  if (buffer.length < 2) return null;

  const sampleRate = 8000;
  const bucketSec = 0.5;
  const bucketSamples = Math.round(sampleRate * bucketSec);
  const sampleCount = Math.floor(buffer.length / 2);

  const buckets: number[] = [];
  for (let offset = 0; offset + bucketSamples <= sampleCount; offset += bucketSamples) {
    let sum = 0;
    for (let i = 0; i < bucketSamples; i++) {
      const value = buffer.readInt16LE((offset + i) * 2) / 32768;
      sum += value * value;
    }
    buckets.push(Math.sqrt(sum / bucketSamples));
  }
  if (buckets.length < 20) return null;

  // 平滑化（前後2バケットの移動平均）
  const smoothed = buckets.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (
      let k = Math.max(0, index - 2);
      k <= Math.min(buckets.length - 1, index + 2);
      k++
    ) {
      sum += buckets[k];
      count++;
    }
    return sum / count;
  });

  const windowBuckets = Math.round(20 / bucketSec);
  if (smoothed.length <= windowBuckets + 2) return null;

  // 最もエネルギー平均の高い窓を探す
  let bestStart = 0;
  let bestAvg = -1;
  let running = 0;
  for (let i = 0; i < smoothed.length; i++) {
    running += smoothed[i];
    if (i >= windowBuckets) running -= smoothed[i - windowBuckets];
    if (i >= windowBuckets - 1) {
      const avg = running / windowBuckets;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestStart = i - windowBuckets + 1;
      }
    }
  }
  if (bestAvg <= 0.0005) return null;

  // しきい値以上の区間まで前後に拡張
  const threshold = bestAvg * 0.62;
  let startBucket = bestStart;
  let endBucket = bestStart + windowBuckets - 1;
  while (startBucket > 0 && smoothed[startBucket - 1] > threshold) startBucket--;
  while (endBucket < smoothed.length - 1 && smoothed[endBucket + 1] > threshold) {
    endBucket++;
  }

  // 長さを12〜40秒に収める
  const minBuckets = Math.round(12 / bucketSec);
  const maxBuckets = Math.round(40 / bucketSec);
  if (endBucket - startBucket + 1 > maxBuckets) {
    const center = Math.round((startBucket + endBucket) / 2);
    startBucket = center - Math.round(maxBuckets / 2);
    endBucket = startBucket + maxBuckets - 1;
  }
  if (endBucket - startBucket + 1 < minBuckets) {
    const center = Math.round((startBucket + endBucket) / 2);
    startBucket = center - Math.round(minBuckets / 2);
    endBucket = startBucket + minBuckets - 1;
  }

  startBucket = Math.max(0, startBucket);
  endBucket = Math.min(smoothed.length - 1, endBucket);

  const start = Math.round(startBucket * bucketSec);
  let end = Math.round((endBucket + 1) * bucketSec);
  if (end - start < 8) return null;
  end = Math.min(end, Math.floor(durationSec));
  if (end <= start) return null;

  return { start, end };
}
