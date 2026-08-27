import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    // drizzle-kit loads .env automatically; .env.example documents the default.
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/firmos",
  },
  strict: true,
  verbose: true,
});
