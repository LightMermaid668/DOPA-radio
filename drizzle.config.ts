import { defineConfig } from "drizzle-kit";

const fallbackUrl = `postgres://${process.env.POSTGRES_USER ?? "dopa"}:${process.env.POSTGRES_PASSWORD ?? "dopa"}@${process.env.POSTGRES_HOST ?? "localhost"}:${process.env.POSTGRES_PORT ?? "5432"}/${process.env.POSTGRES_DB ?? "dopa"}`;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? fallbackUrl,
  },
});
