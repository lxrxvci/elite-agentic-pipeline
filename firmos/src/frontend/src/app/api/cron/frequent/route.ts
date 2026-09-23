import { NextResponse, type NextRequest } from "next/server";

import { getJobDefinition, runJob, type JobRunResult } from "@/server/scheduler";

/**
 * The 5-minute jobs (HANDOFF §9: stale-cleanup, mention-sms, deferred-push)
 * on an HTTP trigger. The daily jobs run one-per-invocation through
 * /api/cron/[job] (vercel.json); this route runs the every-tick trio as a
 * batch so Vercel Hobby - where crons fire at most once a day - still gets
 * the 5-minute cadence via an external scheduler
 * (.github/workflows/cron-frequent.yml).
 *
 * Secured exactly like /api/cron/[job]: `Authorization: Bearer $CRON_SECRET`.
 *
 * §9 "never run two schedulers": this route replaces scripts/scheduler.ts on
 * Vercel deploys - do not run the loop alongside it.
 */

export const runtime = "nodejs";
// Three jobs, each touching at most a recent-window slice of rows.
export const maxDuration = 120;

const FREQUENT_JOBS = ["stale-cleanup", "mention-sms", "deferred-push"] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: JobRunResult[] = [];
  for (const name of FREQUENT_JOBS) {
    // Every name is in JOB_SCHEDULE (scheduler.ts); the guard is for the type.
    const def = getJobDefinition(name);
    if (!def) {
      return NextResponse.json({ error: `Unknown job: ${name}` }, { status: 500 });
    }
    results.push(await runJob(def.name, def.run));
  }

  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 500 });
}
