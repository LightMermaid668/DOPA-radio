import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { and, eq } from "drizzle-orm";

import { db } from "../../src/db";
import { trackPitchVariants, tracks } from "../../src/db/schema";
import { getObjectToFile, putObjectFile } from "../../src/lib/s3";
import { ffprobe } from "../lib/ffprobe";

const execFileAsync = promisify(execFile);

export async function generatePitchVariant(trackId: string, semitones: number): Promise<void> {
  const track = await db.query.tracks.findFirst({ where: eq(tracks.id, trackId) });
  if (!track) throw new Error(`track not found: ${trackId}`);
  if (!track.originalKey) throw new Error(`originalKey missing: ${trackId}`);

  const variantWhere = and(
    eq(trackPitchVariants.trackId, trackId),
    eq(trackPitchVariants.semitones, semitones),
  );

  const workDir = await mkdtemp(path.join(tmpdir(), "dopa-pitch-"));

  try {
    await db
      .update(trackPitchVariants)
      .set({ status: "processing", error: null })
      .where(variantWhere);

    const originalPath = path.join(workDir, "original.bin");
    await getObjectToFile(track.originalKey, originalPath);

    const probe = await ffprobe(originalPath);
    const sourceRate =
      Number(probe.streams?.find((stream) => stream.codec_type === "audio")?.sample_rate) || 44100;

    // ピッチのみ変更（テンポ維持）: asetrate でピッチ+速度をまとめて変え、
    // atempo で速度だけ元に戻す
    const factor = Math.pow(2, semitones / 12);
    const filter = `asetrate=${sourceRate}*${factor},aresample=${sourceRate},atempo=${1 / factor}`;

    const outPath = path.join(workDir, "pitched.m4a");
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      originalPath,
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

    await putObjectFile(`pitch/${trackId}/${semitones}.m4a`, outPath, "audio/mp4");

    await db
      .update(trackPitchVariants)
      .set({ status: "ready", error: null, updatedAt: new Date() })
      .where(variantWhere);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(trackPitchVariants)
      .set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() })
      .where(variantWhere);
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
