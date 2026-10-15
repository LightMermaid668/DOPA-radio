import { PgBoss, type Job } from "pg-boss";

import { databaseUrl } from "../src/db";

const QUEUES = ["transcode"] as const;

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

  await boss.work("transcode", async (jobs: Job[]) => {
    for (const job of jobs) {
      console.log(`[worker] transcode job received: ${job.id}`);
      /* フェーズ1で実装: ffmpeg AAC/HLS変換・ジャケット抽出 */
    }
  });

  console.log(`[worker] listening on queues: ${QUEUES.join(", ")}`);
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
