import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db, pool } from "../src/db";

async function main() {
  console.log("[migrate] applying migrations...");
  await migrate(db, { migrationsFolder: "drizzle" });
  await pool.end();
  console.log("[migrate] done");
}

main().catch((error) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});
