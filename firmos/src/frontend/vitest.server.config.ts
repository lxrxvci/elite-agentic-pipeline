import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Server-side (work engine) tests: node environment, DB-backed, serial
 * (files share one database and re-seed in beforeAll). Run with:
 *   npx vitest run -c vitest.server.config.ts
 *
 * Add to package.json scripts later (not edited by this workstream):
 *   "test:server": "vitest run -c vitest.server.config.ts"
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/server/__tests__/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        `postgres://${process.env.USER ?? "postgres"}@localhost:5432/firmos`,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
