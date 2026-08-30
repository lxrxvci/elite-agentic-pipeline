import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { clientReports, clients, users } from "@/db/schema";
import { toSessionUser, type SessionUser } from "@/server/auth/guards";
import { PortalAccessDeniedError } from "@/server/portal";
import { getPortalReportsCalendar, getPortalYearGrid } from "@/server/portal-progress";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

const CLIENT_EMAIL = "alison@harborlinemarine.com";
const CPA_EMAIL = "carlos@riverstonetax.com";
const OWNER_EMAIL = "mara@blueledgerbooks.com";

let alison: SessionUser;
let carlos: SessionUser;
let mara: SessionUser;
let harborlineId: number; // monthly, alison linked + carlos CPA
let blueSpruceId: number; // monthly, alison linked, caps off
let copperlineId: number; // quarterly, carlos CPA only

async function sessionUserByEmail(email: string): Promise<SessionUser> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return toSessionUser(row);
}

async function clientIdByName(legalName: string): Promise<number> {
  const [row] = await db.select().from(clients).where(eq(clients.legalName, legalName)).limit(1);
  if (!row) throw new Error(`seeded client not found: ${legalName}`);
  return row.id;
}

describe.skipIf(!reachable)("portal progress reads (Wave 4 portal parity)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    savedEnv.FIRMOS_PORTAL_ENABLED = process.env.FIRMOS_PORTAL_ENABLED;
    process.env.FIRMOS_PORTAL_ENABLED = "1";

    await seedDatabase(TEST_TODAY);

    alison = await sessionUserByEmail(CLIENT_EMAIL);
    carlos = await sessionUserByEmail(CPA_EMAIL);
    mara = await sessionUserByEmail(OWNER_EMAIL);
    harborlineId = await clientIdByName("Harborline Marine Supply");
    blueSpruceId = await clientIdByName("Blue Spruce Landscaping");
    copperlineId = await clientIdByName("Copperline Coffee Roasters");
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // ── Year grid scoping (§12 acting-client membership, IDOR) ──

  it("returns the acting client's own year grid with close steps", async () => {
    const grid = await getPortalYearGrid(alison, harborlineId, 2026, TEST_TODAY);
    expect(grid).not.toBeNull();
    expect(grid!.clientId).toBe(harborlineId);
    expect(grid!.year).toBe(2026);
    expect(grid!.rows.map((r) => r.stream)).toEqual([
      "bank_feeds",
      "reconciliations",
      "reports",
      "tasks",
    ]);
    // Monthly cadence: 12 columns, one close-step entry per column.
    expect(grid!.columns).toHaveLength(12);
    expect(grid!.closeSteps).toHaveLength(12);
    for (const close of grid!.closeSteps) {
      expect(close.steps.map((s) => s.key)).toEqual([
        "categorize",
        "reconcile",
        "questions",
        "reports",
      ]);
    }
  });

  it("denies the grid for a client outside the caller's linked set (IDOR)", async () => {
    // Alison is not linked to Copperline (Carlos's CPA client).
    await expect(getPortalYearGrid(alison, copperlineId, 2026, TEST_TODAY)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
  });

  it("denies staff accounts outright (population isolation)", async () => {
    await expect(getPortalYearGrid(mara, harborlineId, 2026, TEST_TODAY)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
  });

  it("CPA rule: linked clients read, unlinked clients denied", async () => {
    const grid = await getPortalYearGrid(carlos, harborlineId, 2026, TEST_TODAY);
    expect(grid).not.toBeNull();
    expect(grid!.clientId).toBe(harborlineId);
    // Carlos is not linked to Blue Spruce.
    await expect(getPortalYearGrid(carlos, blueSpruceId, 2026, TEST_TODAY)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
  });

  // ── Reports calendar scoping + cell states ──

  it("denies the reports calendar for an unlinked client (IDOR)", async () => {
    await expect(
      getPortalReportsCalendar(alison, copperlineId, 2026, TEST_TODAY),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);
  });

  it("scores delivered, past-due, upcoming, and no-work months", async () => {
    // Stage a clean schedule year (2025 predates the seed's generated rows).
    const staged = [
      { name: "Monthly Financial Package", attributedMonth: 3, dueDate: "2025-04-10", completedAt: new Date("2025-04-08T12:00:00Z") },
      { name: "Monthly Financial Package", attributedMonth: 4, dueDate: "2025-05-10", completedAt: null },
      { name: "Monthly Financial Package", attributedMonth: 5, dueDate: null, completedAt: null },
    ];
    for (const row of staged) {
      await db.insert(clientReports).values({
        clientId: harborlineId,
        name: row.name,
        attributedYear: 2025,
        attributedMonth: row.attributedMonth,
        dueDate: row.dueDate,
        completedAt: row.completedAt,
      });
    }

    try {
      const cells = await getPortalReportsCalendar(alison, harborlineId, 2025, TEST_TODAY);
      expect(cells).toHaveLength(12);
      expect(cells.every((c) => c.year === 2025)).toBe(true);

      // March: a completed row delivers even without a document.
      expect(cells[2].state).toBe("delivered");
      // April: open and past its due date reads behind.
      expect(cells[3].state).toBe("past_due");
      expect(cells[3].dueDate).toBe("2025-05-10");
      // May: scheduled, no due date yet stays muted.
      expect(cells[4].state).toBe("upcoming");
      // Nothing scheduled reads as absence.
      expect(cells[0].state).toBe("no_work");
      expect(cells[11].state).toBe("no_work");
    } finally {
      await db
        .delete(clientReports)
        .where(and(eq(clientReports.clientId, harborlineId), eq(clientReports.attributedYear, 2025)));
    }
  });
});
