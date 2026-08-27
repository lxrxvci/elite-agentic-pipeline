import postgres from "postgres";

import type { LocalDate } from "@firmos/domain";

/** Fixed firm-local "today" for the whole server suite (§30 conv. 4). */
export const TEST_TODAY: LocalDate = { year: 2026, month: 8, day: 15 };

/** Seed catch-up floor = first of the month two months before TEST_TODAY. */
export const TEST_CATCHUP = "2026-06-01";

let reachableCache: boolean | null = null;

/**
 * Probe DATABASE_URL once per test file. When it is unreachable the suite
 * skips with a clear message instead of failing spuriously (e.g. Postgres
 * not running locally).
 */
export async function dbReachable(): Promise<boolean> {
  if (reachableCache != null) return reachableCache;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[server-tests] DATABASE_URL is not set - skipping DB-backed server tests");
    reachableCache = false;
    return false;
  }
  const sql = postgres(url, { max: 1, connect_timeout: 3, idle_timeout: 1 });
  try {
    await sql`select 1`;
    reachableCache = true;
  } catch {
    console.warn(
      `[server-tests] DATABASE_URL (${url}) is unreachable - skipping DB-backed server tests`,
    );
    reachableCache = false;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
  return reachableCache;
}

export function clientIdByName(
  rows: { id: number; legalName: string }[],
  name: string,
): number {
  const row = rows.find((r) => r.legalName === name);
  if (!row) throw new Error(`seeded client not found: ${name}`);
  return row.id;
}
