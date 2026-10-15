import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.POSTGRES_USER ?? "dopa";
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "dopa");
  const host = process.env.POSTGRES_HOST ?? "postgres";
  const port = process.env.POSTGRES_PORT ?? "5432";
  const database = process.env.POSTGRES_DB ?? "dopa";
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
}

const globalForDb = globalThis as unknown as { __dopaPool?: Pool };

export const pool = globalForDb.__dopaPool ?? new Pool({ connectionString: databaseUrl(), max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.__dopaPool = pool;

export const db = drizzle(pool, { schema });

export { schema };
