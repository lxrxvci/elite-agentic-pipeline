import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  clients,
  notifications,
  properties,
  propertyProformaRequests,
  users,
} from "@/db/schema";
import { toSessionUser, type SessionUser } from "@/server/auth/guards";
import { getPortalInvoices } from "@/server/portal-invoices";
import { PortalAccessDeniedError, PortalError } from "@/server/portal";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

// Spy on the §15 resync trigger while keeping the real resync: the engine
// imports onPropertyBillingChanged directly, so this intercepts the exact
// call the trigger contract cares about. resyncAllBilling (used by the seed)
// stays real.
vi.mock("@/server/billing-sync", async (importActual) => {
  const actual = await importActual<typeof import("@/server/billing-sync")>();
  return { ...actual, onPropertyBillingChanged: vi.fn(actual.onPropertyBillingChanged) };
});

import { onPropertyBillingChanged } from "@/server/billing-sync";
import {
  createProformaRequest,
  createProperty,
  deleteProperty,
  getClientProperties,
  getProformaStatus,
  submitPortalProforma,
  updateProperty,
  upsertStaffProforma,
} from "@/server/properties";

const reachable = await dbReachable();

const PROFORMA_YEAR = TEST_TODAY.year + 1;

let alison: SessionUser;
let mara: SessionUser;
let sofia: SessionUser;
let riverstoneId: number; // (g) real-estate, alison linked
let blueSpruceId: number; // (b) non-real-estate, alison linked
let copperlineId: number; // (c) alison NOT linked (IDOR target)
let harborlineId: number; // (a) seeded invoices
let mapleCourtId: number; // active, mortgaged
let cedarStreetId: number; // sold

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

async function requestFor(clientId: number, year: number) {
  const rows = await db
    .select()
    .from(propertyProformaRequests)
    .where(
      and(
        eq(propertyProformaRequests.clientId, clientId),
        eq(propertyProformaRequests.year, year),
      ),
    );
  return rows.sort((a, b) => b.id - a.id)[0] ?? null;
}

describe.skipIf(!reachable)("properties engine (HANDOFF §20, §12)", () => {
  const savedPortalEnv = process.env.FIRMOS_PORTAL_ENABLED;

  afterAll(() => {
    if (savedPortalEnv === undefined) delete process.env.FIRMOS_PORTAL_ENABLED;
    else process.env.FIRMOS_PORTAL_ENABLED = savedPortalEnv;
  });

  beforeAll(async () => {
    process.env.FIRMOS_PORTAL_ENABLED = "1";
    await seedDatabase(TEST_TODAY);

    alison = await sessionUserByEmail("alison@harborlinemarine.com");
    mara = await sessionUserByEmail("mara@blueledgerbooks.com");
    sofia = await sessionUserByEmail("sofia@blueledgerbooks.com");
    riverstoneId = await clientIdByName("Riverstone Property Group");
    blueSpruceId = await clientIdByName("Blue Spruce Landscaping");
    copperlineId = await clientIdByName("Copperline Coffee Roasters");
    harborlineId = await clientIdByName("Harborline Marine Supply");

    const seeded = await getClientProperties(riverstoneId);
    mapleCourtId = seeded.find((p) => p.name === "Maple Court Duplex")!.id;
    cedarStreetId = seeded.find((p) => p.name === "Cedar Street Fourplex")!.id;
  });

  it("seeds the real-estate client with an active + a sold property", async () => {
    const rows = await getClientProperties(riverstoneId);
    expect(rows.map((p) => p.name)).toEqual(["Maple Court Duplex", "Cedar Street Fourplex"]);
    expect(rows[0].isSold).toBe(false);
    expect(rows[1].isSold).toBe(true);
  });

  it("CRUD: create and delete fire the billing resync trigger", async () => {
    vi.mocked(onPropertyBillingChanged).mockClear();
    const created = await createProperty(mara.id, {
      clientId: riverstoneId,
      name: "Birch Lane Studio",
      propertyType: "Studio",
      mortgageLender: "Columbia Bank",
      mortgageBalance: "150000",
      qboClassName: "Birch Lane",
    });
    expect(created.id).toBeGreaterThan(0);
    expect(onPropertyBillingChanged).toHaveBeenCalledWith(riverstoneId);

    await deleteProperty(mara.id, created.id);
    expect(onPropertyBillingChanged).toHaveBeenCalledTimes(2);
    const remaining = await getClientProperties(riverstoneId);
    expect(remaining.some((p) => p.name === "Birch Lane Studio")).toBe(false);
  });

  it("CRUD: billing-relevant edits resync (mortgage line falls out at zero); cosmetic edits do not", async () => {
    const loansLine = (template: unknown) =>
      (Array.isArray(template) ? (template as { service_key?: string }[]) : []).some(
        (l) => l.service_key === "loans_and_liabilities",
      );
    const templateHasLoans = async () => {
      const [client] = await db.select().from(clients).where(eq(clients.id, riverstoneId));
      return loansLine(client.recurringServicesTemplate);
    };

    // Seeded Maple Court mortgage put the loans line into the template.
    expect(await templateHasLoans()).toBe(true);

    vi.mocked(onPropertyBillingChanged).mockClear();

    // Clearing the only mortgage: resync fires and the live-derivable line
    // drops out of the template (§15 zero-count rule).
    await updateProperty(mara.id, mapleCourtId, { mortgageBalance: null, mortgageLender: null });
    expect(onPropertyBillingChanged).toHaveBeenCalledTimes(1);
    expect(await templateHasLoans()).toBe(false);

    // Restoring it brings the line back.
    await updateProperty(mara.id, mapleCourtId, {
      mortgageLender: "Columbia Bank",
      mortgageBalance: "312450",
    });
    expect(onPropertyBillingChanged).toHaveBeenCalledTimes(2);
    expect(await templateHasLoans()).toBe(true);

    // Address-only edit: not billing-relevant, no resync.
    await updateProperty(mara.id, mapleCourtId, { addressLine1: "414 Maple Ct" });
    expect(onPropertyBillingChanged).toHaveBeenCalledTimes(2);

    // Sold status is billing-relevant (sold properties drop out of the
    // live mortgage count).
    await updateProperty(mara.id, mapleCourtId, { isSold: true });
    expect(onPropertyBillingChanged).toHaveBeenCalledTimes(3);
    await updateProperty(mara.id, mapleCourtId, { isSold: false });
    expect(onPropertyBillingChanged).toHaveBeenCalledTimes(4);
  });

  it("request -> portal submit auto-completes once every non-sold property submitted (sold excluded)", async () => {
    // Seed state: Maple Court has a STAFF-entered 2027 row. A staff row must
    // NOT satisfy the request - only portal submissions count.
    const { request, created } = await createProformaRequest(riverstoneId, PROFORMA_YEAR, mara.id);
    expect(created).toBe(true);
    expect(request.status).toBe("pending");

    // The client's portal user got notified (§20).
    const portalNotices = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, alison.id),
          eq(notifications.notificationType, "proforma_request"),
        ),
      );
    expect(portalNotices.length).toBeGreaterThan(0);

    // Idempotent: a second request returns the pending one without duplicates.
    const again = await createProformaRequest(riverstoneId, PROFORMA_YEAR, mara.id);
    expect(again.created).toBe(false);
    expect(again.request.id).toBe(request.id);

    // Staff-entered row already exists for Maple Court - still pending.
    let status = await getProformaStatus(riverstoneId, PROFORMA_YEAR);
    const mapleCell = status.cells.find((c) => c.propertyId === mapleCourtId)!;
    expect(mapleCell.status).toBe("staff_entered");
    const cedarCell = status.cells.find((c) => c.propertyId === cedarStreetId)!;
    expect(cedarCell.status).toBe("sold_excluded");
    expect(status.requiredCount).toBe(1); // sold property excluded

    // Portal submission for the one non-sold property completes the request
    // even though the sold property never gets a row.
    const result = await submitPortalProforma(alison, riverstoneId, mapleCourtId, PROFORMA_YEAR, {
      rental_income: 40800,
      property_taxes: 5200,
      notes: "Expecting the same rent roll",
    });
    expect(result.requestCompleted).toBe(true);

    const completed = await requestFor(riverstoneId, PROFORMA_YEAR);
    expect(completed?.status).toBe("completed");
    expect(completed?.completedAt).not.toBeNull();

    // Bookkeeper (sofia), manager, and requester get the completion notice.
    const staffNotices = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, sofia.id),
          eq(notifications.notificationType, "proforma_completed"),
        ),
      );
    expect(staffNotices.length).toBeGreaterThan(0);

    status = await getProformaStatus(riverstoneId, PROFORMA_YEAR);
    expect(status.cells.find((c) => c.propertyId === mapleCourtId)!.status).toBe("portal_submitted");
    expect(status.request?.status).toBe("completed");
  });

  it("stays pending until ALL non-sold properties have portal rows", async () => {
    const year = PROFORMA_YEAR + 10; // fresh year, no rows
    const duplex2 = await createProperty(mara.id, {
      clientId: riverstoneId,
      name: "Alder Street Condo",
    });

    await createProformaRequest(riverstoneId, year, mara.id);

    // Staff entry for one property: not enough (staff rows never count).
    await upsertStaffProforma(mara.id, mapleCourtId, year, { rental_income: 41000 });
    let req = await requestFor(riverstoneId, year);
    expect(req?.status).toBe("pending");

    // Portal submits the first of two non-sold properties: still pending.
    const first = await submitPortalProforma(alison, riverstoneId, mapleCourtId, year, {
      rental_income: 41000,
    });
    expect(first.requestCompleted).toBe(false);
    req = await requestFor(riverstoneId, year);
    expect(req?.status).toBe("pending");

    // Second non-sold property via the portal: request auto-completes.
    const second = await submitPortalProforma(alison, riverstoneId, duplex2.id, year, {
      rental_income: 18600,
    });
    expect(second.requestCompleted).toBe(true);
    req = await requestFor(riverstoneId, year);
    expect(req?.status).toBe("completed");

    await deleteProperty(mara.id, duplex2.id);
  });

  it("rejects pro-forma requests for non-real-estate clients", async () => {
    await expect(createProformaRequest(blueSpruceId, PROFORMA_YEAR, mara.id)).rejects.toThrow(
      /real-estate/,
    );
    await expect(
      submitPortalProforma(alison, blueSpruceId, mapleCourtId, PROFORMA_YEAR, { rental_income: 1 }),
    ).rejects.toThrow(PortalError);
  });

  it("IDOR: a portal user cannot submit for a client they are not linked to", async () => {
    await expect(
      submitPortalProforma(alison, copperlineId, mapleCourtId, PROFORMA_YEAR, { rental_income: 1 }),
    ).rejects.toThrow(PortalAccessDeniedError);
  });

  it("portal invoices: non-draft only, membership-guarded", async () => {
    const rows = await getPortalInvoices(alison, harborlineId);
    expect(rows.length).toBe(2); // paid + sent; the seeded draft is filtered
    expect(rows.map((r) => r.status).sort()).toEqual(["paid", "sent"]);
    expect(rows.map((r) => r.invoiceNumber).sort()).toEqual([
      `INV-${TEST_TODAY.year}-0001`,
      `INV-${TEST_TODAY.year}-0002`,
    ]);

    await expect(getPortalInvoices(alison, copperlineId)).rejects.toThrow(PortalAccessDeniedError);
  });

  it("validation: rejects bad money and bad years", async () => {
    await expect(
      createProperty(mara.id, { clientId: riverstoneId, name: "Bad", mortgageBalance: "abc" }),
    ).rejects.toThrow(/must be a number/);
    await expect(
      upsertStaffProforma(mara.id, mapleCourtId, 1999, { rental_income: 1 }),
    ).rejects.toThrow(/Year/);
    const [row] = await db.select().from(properties).where(eq(properties.id, mapleCourtId));
    expect(row.clientId).toBe(riverstoneId);
  });
});
