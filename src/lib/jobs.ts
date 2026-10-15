import { PgBoss } from "pg-boss";

import { databaseUrl } from "@/db";

const globalForBoss = globalThis as unknown as { __dopaBoss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.__dopaBoss) {
    globalForBoss.__dopaBoss = (async () => {
      const boss = new PgBoss({ connectionString: databaseUrl() });
      boss.on("error", (error) => console.error("[pg-boss:web]", error));
      await boss.start();
      await boss.createQueue("transcode");
      return boss;
    })();
  }
  return globalForBoss.__dopaBoss;
}

export async function enqueueTranscode(trackId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send("transcode", { trackId }, { expireInSeconds: 3600, retryLimit: 1 });
}
