/**
 * FirmOS background scheduler loop (HANDOFF §9) - dev/self-host runner.
 *
 *   npx tsx scripts/scheduler.ts
 *
 * One process, 5-minute ticks. On startup it runs the generation jobs once
 * and seeds the time-gated notification jobs to "yesterday" so a 2 AM
 * restart does not blast alerts (§9). On Vercel the daily jobs run through
 * /api/cron/[job] instead (vercel.json); the 5-minute jobs belong to this
 * loop (§9's job table).
 *
 * NEVER run two schedulers (§9: the legacy double-fire bug). Enforced by a
 * Postgres session-level advisory lock on a dedicated single-connection
 * client: a second loop fails to take the lock and exits.
 */
import postgres from "postgres";

// Scripts run outside Next, which is what auto-loads .env. The scheduler
// module graph touches src/db (which requires DATABASE_URL at import), so
// it is imported dynamically inside main(), AFTER the env file loads.
try {
  process.loadEnvFile();
} catch {
  // no .env next to the CWD - DATABASE_URL must come from the environment
}

const TICK_MS = 5 * 60 * 1000;
// Arbitrary stable int64 key for the scheduler's advisory lock.
const ADVISORY_LOCK_KEY = 727_424_001;

async function main(): Promise<void> {
  const { startupRun, schedulerTick } = await import("../src/server/scheduler");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[scheduler] DATABASE_URL is not set (see .env.example)");
    process.exit(1);
  }

  // max: 1 - every query on this client shares one session, so the lock is
  // held for the process lifetime and released when the connection drops.
  const lockClient = postgres(url, { max: 1 });
  const [lock] = await lockClient<
    [{ acquired: boolean }]
  >`select pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) as acquired`;
  if (!lock.acquired) {
    console.error(
      "[scheduler] another scheduler instance holds the advisory lock - exiting (§9: never run two)",
    );
    await lockClient.end();
    process.exit(1);
  }

  console.log("[scheduler] startup run (§9: generation jobs once, notification jobs seeded)");
  const startupResults = await startupRun();
  for (const r of startupResults) {
    if (!r.ok) console.error(`[scheduler] startup ${r.name} failed: ${r.error}`);
  }

  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return; // a long tick never overlaps the next one
    inFlight = true;
    schedulerTick()
      .catch((err) => console.error("[scheduler] tick failed:", err))
      .finally(() => {
        inFlight = false;
      });
  }, TICK_MS);
  console.log(`[scheduler] ticking every ${TICK_MS / 1000}s`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[scheduler] ${signal} - shutting down`);
    clearInterval(timer);
    // Closing the lock connection releases the session-level advisory lock.
    await lockClient.end().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[scheduler] fatal:", err);
  process.exit(1);
});
