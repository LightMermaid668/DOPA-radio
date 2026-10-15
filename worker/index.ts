import { PgBoss, type Job } from "pg-boss";

import { databaseUrl } from "../src/db";
import { generatePitchVariant } from "./handlers/pitch";
import { transcodeTrack } from "./handlers/transcode";

const QUEUES = ["transcode", "pitch"] as const;

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

  console.log(`[worker] listening on queues: ${QUEUES.join(", ")}`);
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
