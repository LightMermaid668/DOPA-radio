import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { tracks } from "../../src/db/schema";
import { getObjectToFile, putObjectFile } from "../../src/lib/s3";
import { buildCrossfadeFile } from "../lib/crossfade";
import { ffprobe } from "../lib/ffprobe";

export function crossfadeKeyFor(trackId: string): string {
  return `crossfade/${trackId}.m4a`;
}

/** 既存曲向け: クロスフェード用音源を生成してアップロードする */
export async function generateCrossfadeVariant(trackId: string): Promise<void> {
  const track = await db.query.tracks.findFirst({ where: eq(tracks.id, trackId) });
  if (!track) throw new Error(`track not found: ${trackId}`);
  if (!track.originalKey) throw new Error(`originalKey missing: ${trackId}`);

  const workDir = await mkdtemp(path.join(tmpdir(), "dopa-crossfade-"));

  try {
    const originalPath = path.join(workDir, "original.bin");
    await getObjectToFile(track.originalKey, originalPath);

    const probe = await ffprobe(originalPath);
    const probed = Number(probe.format?.duration ?? 0);
    const duration =
      Number.isFinite(probed) && probed > 0 ? probed : (track.durationSec ?? 0);
    if (!duration || duration <= 0) throw new Error("再生時間を取得できませんでした");

    const outPath = path.join(workDir, "crossfade.m4a");
    await buildCrossfadeFile(originalPath, duration, outPath);

    const key = crossfadeKeyFor(trackId);
    await putObjectFile(key, outPath, "audio/mp4");

    await db
      .update(tracks)
      .set({ crossfadeKey: key, updatedAt: new Date() })
      .where(eq(tracks.id, trackId));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
