import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type FfprobeResult = {
  format?: { duration?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; sample_rate?: string }>;
};

export async function ffprobe(filePath: string): Promise<FfprobeResult> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-show_entries",
    "stream=codec_type,codec_name,sample_rate",
    "-of",
    "json",
    filePath,
  ]);
  return JSON.parse(stdout) as FfprobeResult;
}
