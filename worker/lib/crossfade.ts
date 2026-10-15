import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// クロスフェードの重なり秒数。クライアント側の CROSSFADE_SEC と揃えること
export const CROSSFADE_IN_SEC = 3;
export const CROSSFADE_OUT_SEC = 6;

/**
 * 頭フェードイン・末尾フェードアウトを焼き込んだクロスフェード用音源を作る。
 * iOSは実行時に要素の音量を変えられないため、フェードを音源自体に焼き込む。
 */
export async function buildCrossfadeFile(
  inputPath: string,
  durationSec: number,
  outPath: string,
): Promise<void> {
  const fadeIn = Math.min(CROSSFADE_IN_SEC, Math.max(0.5, durationSec / 4));
  const fadeOut = Math.min(CROSSFADE_OUT_SEC, Math.max(0.5, durationSec / 2));
  const outStart = Math.max(0, durationSec - fadeOut);
  const filter = [
    `afade=t=in:st=0:d=${fadeIn.toFixed(2)}`,
    `afade=t=out:st=${outStart.toFixed(2)}:d=${fadeOut.toFixed(2)}`,
  ].join(",");

  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-af",
    filter,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outPath,
  ]);
}
