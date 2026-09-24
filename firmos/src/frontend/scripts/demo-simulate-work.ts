/**
 * Demo work simulation: makes the seeded firm look ALIVE by reconciling
 * ~90% of overdue periodic work (bank feeds, reconciliations, reports) and
 * overdue tasks, with believable completion timestamps (due date + 0-3 days,
 * during working hours) attributed to the client's assigned bookkeeper when
 * known, else a random seed bookkeeper.
 *
 * Deliberately leaves ~10% overdue so the demo reads as real, in-flight work
 * rather than a sterile perfect state.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/demo-simulate-work.ts          # apply
 *   DATABASE_URL=postgres://... npx tsx scripts/demo-simulate-work.ts --dry    # counts only
 */
import postgres from "postgres";

const DRY = process.argv.includes("--dry");
const COMPLETE_RATIO = 0.9;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = postgres(url, { prepare: false });

async function main() {
  const bookkeepers = await sql<{ id: number }[]>`
    select id from users where role in ('bookkeeper','manager') order by id`;
  if (bookkeepers.length === 0) throw new Error("no bookkeeper/manager users seeded");
  const bkIds = bookkeepers.map((b) => b.id);
  // postgres.js can't subscript an untyped parameter - inline the int array.
  const bkArray = sql.unsafe(`(ARRAY[${bkIds.join(",")}])::int[]`);

  // Prefer the client's assigned bookkeeper when the column exists.
  const hasAssignee = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_name = 'clients' and column_name = 'bookkeeper_id') as exists`;
  const useAssignee = hasAssignee[0]?.exists === true;

  const tables = [
    { name: "weekly_bank_feeds", statusCol: null, parkedCols: true },
    { name: "account_reconciliations", statusCol: null, parkedCols: false },
    { name: "client_reports", statusCol: null, parkedCols: false },
    { name: "tasks", statusCol: "status", parkedCols: false },
  ] as const;

  for (const t of tables) {
    // tasks completes via status; the periodic tables via is_completed.
    const [{ count: open }] = t.statusCol
      ? await sql<[{ count: number }]>`
          select count(*)::int as count from ${sql(t.name)}
          where status not in ('completed','cancelled') and due_date < current_date`
      : await sql<[{ count: number }]>`
          select count(*)::int as count from ${sql(t.name)}
          where is_completed = false and due_date < current_date`;
    if (DRY) {
      console.log(`${t.name}: ${open} overdue -> would complete ~${Math.round(open * COMPLETE_RATIO)}`);
      continue;
    }

    const pickBookkeeper = sql`(${bkArray})[floor(random() * ${bkIds.length})::int + 1]`;
    const completedBy = useAssignee
      ? sql`coalesce((select bookkeeper_id from clients c where c.id = ${sql(t.name)}.client_id),
                     ${pickBookkeeper})`
      : pickBookkeeper;

    // Believable completion: on/just-after the due date, 9am-5pm.
    const completedAt = sql`(
      ${sql(t.name)}.due_date::timestamp
      + (floor(random() * 3)::int || ' days')::interval
      + (floor(random() * 8)::int || ' hours')::interval
      + interval '9 hours'
    )`;

    let updated: number;
    if (t.statusCol) {
      const res = await sql`
        update ${sql(t.name)}
        set status = 'completed', completed_at = ${completedAt}, completed_by_id = ${completedBy},
            updated_at = now()
        where status not in ('completed','cancelled') and due_date < current_date
          and random() < ${COMPLETE_RATIO}`;
      updated = res.count;
    } else if (t.parkedCols) {
      const res = await sql`
        update ${sql(t.name)}
        set is_completed = true, completed_at = ${completedAt}, completed_by_id = ${completedBy},
            waiting_on_client = false, deferred_until = null, updated_at = now()
        where is_completed = false and due_date < current_date
          and random() < ${COMPLETE_RATIO}`;
      updated = res.count;
    } else {
      const res = await sql`
        update ${sql(t.name)}
        set is_completed = true, completed_at = ${completedAt}, completed_by_id = ${completedBy},
            updated_at = now()
        where is_completed = false and due_date < current_date
          and random() < ${COMPLETE_RATIO}`;
      updated = res.count;
    }
    console.log(`${t.name}: completed ${updated} of ${open} overdue`);
  }

  // Recurring task instances share the tasks table (handled above); settle
  // waiting/deferred rows that look stale so the queue reads clean.
  if (!DRY) {
    const feeds = await sql`
      update weekly_bank_feeds set waiting_on_client = false, deferred_until = null, updated_at = now()
      where is_completed = true and (waiting_on_client = true or deferred_until is not null)`;
    console.log(`weekly_bank_feeds: cleared stale waiting/deferred flags on ${feeds.count} completed rows`);
  }
}

void (async () => {
  await main();
  await sql.end();
  console.log(DRY ? "dry run complete" : "demo simulation applied");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
