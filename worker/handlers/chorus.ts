import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";

import { db } from "../../src/db";
import { tracks } from "../../src/db/schema";
import { getObjectToFile } from "../../src/lib/s3";
import { detectChorus } from "../lib/chorus";

export async function detectTrackChorus(trackId: string): Promise<void> {
  const track = await db.query.tracks.findFirst({ where: eq(tracks.id, trackId) });
  if (!track) throw new Error(`track not found: ${trackId}`);
  if (!track.originalKey) throw new Error(`originalKey missing: ${trackId}`);
  if (track.chorusSource === "manual") {
    // 手動設定は上書きしない
    return;
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "dopa-chorus-"));
  try {
    const originalPath = path.join(workDir, "original.bin");
    await getObjectToFile(track.originalKey, originalPath);

    const chorus = await detectChorus(originalPath, track.durationSec ?? 0);

    await db
      .update(tracks)
      .set({
        chorusStartSec: chorus?.start ?? null,
        chorusEndSec: chorus?.end ?? null,
        // "none" = 解析済みだがサビを特定できなかった（未解析nullと区別）
        chorusSource: chorus ? "auto" : "none",
        updatedAt: new Date(),
      })
      .where(eq(tracks.id, trackId));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
