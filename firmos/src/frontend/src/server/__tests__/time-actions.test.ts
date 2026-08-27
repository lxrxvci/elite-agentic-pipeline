import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/server/auth/guards";
import type { HoursReport } from "@/server/time-tracking";

/**
 * Regression coverage for the YYYY-MM-DD parsing pitfall in the hours-report
 * action: new Date("2026-08-01") parses as UTC midnight, which lands on the
 * previous local day in every Americas timezone. The action must parse
 * firm-local day starts and clamp the inclusive `to` at now, matching
 * getDailyHoursAction. The engine is mocked; only the action's date handling
 * is under test.
 */

const mocks = vi.hoisted(() => ({ getHoursReport: vi.fn() }));

vi.mock("@/server/auth/guards", () => ({
  requireStaff: vi.fn(async () => ({ id: 1, normalizedRole: "admin" }) as SessionUser),
  requireRole: vi.fn(),
}));

vi.mock("@/server/time-tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/time-tracking")>()),
  getHoursReport: mocks.getHoursReport,
}));

import { getHoursReportAction } from "@/server/actions/time";

const EMPTY_REPORT: HoursReport = { from: "", to: "", users: [] };

describe("getHoursReportAction date handling", () => {
  beforeEach(() => {
    mocks.getHoursReport.mockReset();
    mocks.getHoursReport.mockResolvedValue(EMPTY_REPORT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses YYYY-MM-DD as local day starts, to inclusive", async () => {
    const result = await getHoursReportAction("2026-08-01", "2026-08-15");
    expect(result.ok).toBe(true);

    const args = mocks.getHoursReport.mock.calls[0]?.[0] as { from: Date; to: Date };
    // Local-midnight fields, not UTC: new Date("2026-08-01") would show
    // Jul 31 in any timezone behind UTC.
    expect(args.from.getFullYear()).toBe(2026);
    expect(args.from.getMonth()).toBe(7);
    expect(args.from.getDate()).toBe(1);
    expect(args.from.getHours()).toBe(0);
    expect(args.from.getMinutes()).toBe(0);
    // `to` is the exclusive start of the day AFTER the inclusive end date.
    expect(args.to.getFullYear()).toBe(2026);
    expect(args.to.getMonth()).toBe(7);
    expect(args.to.getDate()).toBe(16);
    expect(args.to.getHours()).toBe(0);
  });

  it("clamps a future `to` at now so running timers never accrue forward", async () => {
    const now = new Date(2026, 7, 27, 12, 30, 0);
    vi.useFakeTimers({ now });

    const result = await getHoursReportAction("2026-08-01", "2099-12-31");
    expect(result.ok).toBe(true);

    const args = mocks.getHoursReport.mock.calls[0]?.[0] as { from: Date; to: Date };
    expect(args.to.getTime()).toBe(now.getTime());
  });

  it("rejects malformed or inverted ranges without hitting the engine", async () => {
    expect(await getHoursReportAction("08/01/2026", "2026-08-15")).toEqual({
      ok: false,
      error: "Invalid date range",
    });
    expect(await getHoursReportAction("2026-08-15", "2026-08-01")).toEqual({
      ok: false,
      error: "Invalid date range",
    });
    expect(mocks.getHoursReport).not.toHaveBeenCalled();
  });
});
