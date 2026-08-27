import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * FirmOS database client (Postgres 16, postgres-js driver). Single tenant
 * per ADR-0005. Server-only - import from route handlers, server actions,
 * and jobs; never from client components.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set (see .env.example)");
}

// Global memoization avoids exhausting connections under Next.js dev reloads.
const globalForDb = globalThis as unknown as { __firmosPg?: postgres.Sql };
const client = globalForDb.__firmosPg ?? postgres(connectionString);
if (process.env.NODE_ENV !== "production") globalForDb.__firmosPg = client;

export const db = drizzle(client, { schema });
export { schema };
