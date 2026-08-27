import { NextResponse, type NextRequest } from "next/server";

import { getJobDefinition, runJob } from "@/server/scheduler";

/**
 * Vercel Cron entry (HANDOFF §9): runs ONE named job per invocation.
 * Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when the
 * CRON_SECRET env var is set; anything without it gets a 401.
 *
 * vercel.json schedules the daily jobs here. The 5-minute jobs
 * (stale-cleanup, mention-sms, deferred-push) belong to the long-running
 * scheduler loop (scripts/scheduler.ts), never to cron - and never both
 * (§9: never run two schedulers).
 */

export const runtime = "nodejs";
// Daily jobs touch every client; give materialize room.
export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job } = await params;
  const def = getJobDefinition(job);
  if (!def) {
    return NextResponse.json({ error: `Unknown job: ${job}` }, { status: 404 });
  }

  const result = await runJob(def.name, def.run);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
