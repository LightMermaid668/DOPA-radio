import { and, eq, isNull } from "drizzle-orm";
import { PgBoss, type Job } from "pg-boss";

import { db, databaseUrl } from "../src/db";
import { tracks } from "../src/db/schema";
import { detectTrackChorus } from "./handlers/chorus";
import { generatePitchVariant } from "./handlers/pitch";
import { transcodeTrack } from "./handlers/transcode";

const QUEUES = ["transcode", "pitch", "chorus"] as const;

/** 起動時に、まだサビ解析していない曲を自動で解析キューへ入れる（バックグラウンド適用） */
async function enqueueChorusBackfill(boss: PgBoss) {
  const rows = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(and(eq(tracks.status, "ready"), isNull(tracks.chorusSource)));
  for (const row of rows) {
    await boss.send(
      "chorus",
      { trackId: row.id },
      { expireInSeconds: 1800, retryLimit: 1, singletonKey: `chorus-${row.id}` },
    );
  }
  if (rows.length > 0) {
    console.log(`[worker] chorus backfill enqueued: ${rows.length} track(s)`);
  }
}

async function main() {
  const boss = new PgBoss({ connectionString: databaseUrl() });

  boss.on("error", (error) => {
    console.error("[pg-boss]", error);
  });

  await boss.start();
  console.log("[worker] pg-boss started");

  for (const queue of QUEUES) {
    await boss.createQueue(queue);
  }

  // 未解析の曲をバックグラウンドで自動解析（結果はDBに自動保存される）
  try {
    await enqueueChorusBackfill(boss);
  } catch (error) {
    console.error("[worker] chorus backfill failed:", error);
  }

  await boss.work(
    "transcode",
    { batchSize: 1, pollingIntervalSeconds: 2 },
    async (jobs: Job<{ trackId: string }>[]) => {
      for (const job of jobs) {
        const { trackId } = job.data;
        console.log(`[worker] transcode start: ${trackId}`);
        await transcodeTrack(trackId);
        console.log(`[worker] transcode done: ${trackId}`);
      }
    },
  );

  await boss.work(
    "pitch",
    { batchSize: 1, pollingIntervalSeconds: 2 },
    async (jobs: Job<{ trackId: string; semitones: number }>[]) => {
      for (const job of jobs) {
        const { trackId, semitones } = job.data;
        console.log(`[worker] pitch start: ${trackId} (${semitones})`);
        await generatePitchVariant(trackId, semitones);
        console.log(`[worker] pitch done: ${trackId} (${semitones})`);
      }
    },
  );

  await boss.work(
    "chorus",
    { batchSize: 1, pollingIntervalSeconds: 2 },
    async (jobs: Job<{ trackId: string }>[]) => {
      for (const job of jobs) {
        const { trackId } = job.data;
        console.log(`[worker] chorus start: ${trackId}`);
        await detectTrackChorus(trackId);
        console.log(`[worker] chorus done: ${trackId}`);
      }
    },
  );

  console.log(`[worker] listening on queues: ${QUEUES.join(", ")}`);
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
