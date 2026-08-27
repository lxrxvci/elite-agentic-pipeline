import { and, eq } from "drizzle-orm";
import { workPeriodForDue, addDays } from "@firmos/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  appSettings,
  authSessions,
  authVerifications,
  clientUserAccess,
  clients,
  notifications,
  portalChangeRequests,
  users,
} from "@/db/schema";
import { auth } from "@/server/auth/config";
import { getLastMagicLink } from "@/server/auth/dev-links";
import { toSessionUser, type SessionUser } from "@/server/auth/guards";
import {
  assertPortalCapability,
  assertPortalCapabilityFor,
  createPortalRequest,
  getCpaClientDetail,
  getCpaClients,
  getPortalContext,
  getPortalProfile,
  getPortalTaskOverview,
  getWaitingOnYou,
  isPortalEnabled,
  PortalAccessDeniedError,
  PortalCapabilityError,
  PortalClientSelectionRequired,
  PortalDisabledError,
  requestPortalChange,
  requirePortalClient,
  selectPortalClient,
  updatePortalProfile,
} from "@/server/portal";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

const CLIENT_EMAIL = "alison@harborlinemarine.com";
const CPA_EMAIL = "carlos@riverstonetax.com";
const OWNER_EMAIL = "mara@blueledgerbooks.com";

let alison: SessionUser;
let carlos: SessionUser;
let mara: SessionUser;
let harborlineId: number; // (a) monthly, alison linked + carlos CPA
let blueSpruceId: number; // (b) monthly, alison linked, caps off
let copperlineId: number; // (c) quarterly, carlos CPA only
let jorgeId: number; // bookkeeper for Harborline
let danaId: number; // manager for Harborline

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

describe.skipIf(!reachable)("portal engine (HANDOFF §12, §29)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    savedEnv.FIRMOS_PORTAL_ENABLED = process.env.FIRMOS_PORTAL_ENABLED;
    savedEnv.FIRMOS_DEV_LINKS = process.env.FIRMOS_DEV_LINKS;
    process.env.FIRMOS_PORTAL_ENABLED = "1";
    process.env.FIRMOS_DEV_LINKS = "1";

    await seedDatabase(TEST_TODAY);

    alison = await sessionUserByEmail(CLIENT_EMAIL);
    carlos = await sessionUserByEmail(CPA_EMAIL);
    mara = await sessionUserByEmail(OWNER_EMAIL);
    harborlineId = await clientIdByName("Harborline Marine Supply");
    blueSpruceId = await clientIdByName("Blue Spruce Landscaping");
    copperlineId = await clientIdByName("Copperline Coffee Roasters");
    jorgeId = (await sessionUserByEmail("jorge@blueledgerbooks.com")).id;
    danaId = (await sessionUserByEmail("dana@blueledgerbooks.com")).id;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // ── Linked-client derivation (§12) ──

  it("derives client-role linked clients from ContactClientLinks with capability flags", async () => {
    const ctx = await getPortalContext(alison);
    expect(ctx.role).toBe("client");
    // §20: the seed also links Alison to Riverstone Property Group (real estate).
    const riverstoneId = await clientIdByName("Riverstone Property Group");
    expect(ctx.clients.map((c) => c.clientId).sort()).toEqual(
      [harborlineId, blueSpruceId, riverstoneId].sort(),
    );
    const harborline = ctx.clients.find((c) => c.clientId === harborlineId)!;
    const blueSpruce = ctx.clients.find((c) => c.clientId === blueSpruceId)!;
    expect(harborline.relationship).toBe("owner");
    expect(harborline.capabilities).toEqual({
      canUploadDocs: true,
      canViewTasks: true,
      canMessage: true,
    });
    expect(blueSpruce.capabilities.canUploadDocs).toBe(false);
    expect(blueSpruce.capabilities.canViewTasks).toBe(false);
  });

  it("derives cpa-role linked clients from clients.cpa_contact_id, upload forced off", async () => {
    const ctx = await getPortalContext(carlos);
    expect(ctx.role).toBe("cpa");
    expect(ctx.clients.map((c) => c.clientId).sort()).toEqual(
      [harborlineId, copperlineId].sort(),
    );
    for (const c of ctx.clients) {
      expect(c.relationship).toBe("cpa");
      // §12: CPA upload capability is forced off no matter what is provisioned.
      expect(c.capabilities.canUploadDocs).toBe(false);
    }
  });

  it("keeps CPA upload forced off even when the access row grants it (§12)", async () => {
    await db
      .update(clientUserAccess)
      .set({ canUploadDocs: true })
      .where(and(eq(clientUserAccess.userId, carlos.id), eq(clientUserAccess.clientId, harborlineId)));
    try {
      await expect(
        assertPortalCapabilityFor(carlos, harborlineId, "can_upload_docs"),
      ).rejects.toBeInstanceOf(PortalCapabilityError);
    } finally {
      await db
        .update(clientUserAccess)
        .set({ canUploadDocs: false })
        .where(
          and(eq(clientUserAccess.userId, carlos.id), eq(clientUserAccess.clientId, harborlineId)),
        );
    }
  });

  it("rejects staff users from the portal context outright", async () => {
    await expect(getPortalContext(mara)).rejects.toBeInstanceOf(PortalAccessDeniedError);
  });

  // ── Acting-client cookie semantics (§12) ──

  it("missing acting-client selection throws the 412-equivalent", async () => {
    await expect(requirePortalClient(alison, null)).rejects.toBeInstanceOf(
      PortalClientSelectionRequired,
    );
    // No request scope at all behaves the same as a missing cookie.
    await expect(requirePortalClient(alison)).rejects.toMatchObject({ status: 412 });
  });

  it("valid acting-client selection returns the access entry", async () => {
    const access = await requirePortalClient(alison, String(blueSpruceId));
    expect(access.clientId).toBe(blueSpruceId);
  });

  it("stale or foreign acting-client selection throws the 403-equivalent", async () => {
    await expect(requirePortalClient(alison, String(copperlineId))).rejects.toMatchObject({
      status: 403,
    });
    await expect(requirePortalClient(alison, "not-a-number")).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
  });

  it("selectPortalClient validates membership", async () => {
    const access = await selectPortalClient(alison, harborlineId);
    expect(access.clientId).toBe(harborlineId);
    await expect(selectPortalClient(alison, copperlineId)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
  });

  // ── IDOR battery: no cross-client reads or writes, either role ──

  it("client-role user cannot read or act on an unlinked client, on any query", async () => {
    await expect(getWaitingOnYou(alison, copperlineId)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
    await expect(getPortalTaskOverview(alison, copperlineId, TEST_TODAY)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
    await expect(getPortalProfile(alison, copperlineId)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
    await expect(
      updatePortalProfile(alison, copperlineId, { phone: "503-555-0100" }),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);
    await expect(
      requestPortalChange(alison, copperlineId, "tax_structure", "LLC"),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);
    await expect(
      createPortalRequest(alison, copperlineId, "document", "need docs"),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);
  });

  it("cpa-role user cannot read or act on an unlinked client, on any query", async () => {
    await expect(getCpaClientDetail(carlos, blueSpruceId)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
    await expect(getWaitingOnYou(carlos, blueSpruceId)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
    await expect(getPortalTaskOverview(carlos, blueSpruceId, TEST_TODAY)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
    await expect(
      requestPortalChange(carlos, blueSpruceId, "tax_structure", "LLC"),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);
    await expect(
      createPortalRequest(carlos, blueSpruceId, "team", "call me"),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);
  });

  it("client-role users have no CPA surface and CPAs have no cookie selection surface requirement", async () => {
    await expect(getCpaClients(alison)).rejects.toBeInstanceOf(PortalAccessDeniedError);
    await expect(getCpaClientDetail(alison, harborlineId)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
    // CPAs pass the client id explicitly; it is validated per call.
    const detail = await getCpaClientDetail(carlos, harborlineId);
    expect(detail.client.id).toBe(harborlineId);
  });

  // ── Capability enforcement (§29: enforced by construction) ──

  it("denies upload capability where can_upload_docs is false", async () => {
    const ctx = await getPortalContext(alison);
    const blueSpruce = ctx.clients.find((c) => c.clientId === blueSpruceId)!;
    expect(() => assertPortalCapability(blueSpruce, "can_upload_docs")).toThrow(
      PortalCapabilityError,
    );
    await expect(
      assertPortalCapabilityFor(alison, blueSpruceId, "can_upload_docs"),
    ).rejects.toMatchObject({ status: 403, capability: "can_upload_docs" });
  });

  it("denies the task overview where can_view_tasks is false", async () => {
    await expect(getPortalTaskOverview(alison, blueSpruceId, TEST_TODAY)).rejects.toBeInstanceOf(
      PortalCapabilityError,
    );
  });

  it("returns the task overview with queue bucketing and no staff-only fields", async () => {
    const overview = await getPortalTaskOverview(alison, harborlineId, TEST_TODAY);
    expect(overview.today).toBe("2026-08-15");
    expect(overview.cards.length).toBeGreaterThan(0);
    const allowedBuckets = new Set(["overdue", "due_today", "upcoming", "waiting_on_client", "deferred", "gated"]);
    for (const card of overview.cards) {
      expect(allowedBuckets.has(card.status)).toBe(true);
      // No staff internals: no assignee id, no internal notes, no client id.
      expect(card).not.toHaveProperty("assigneeId");
      expect(card).not.toHaveProperty("clientId");
      expect(card).not.toHaveProperty("description");
      if (card.assigneeFirstName != null) {
        expect(typeof card.assigneeFirstName).toBe("string");
        expect(card.assigneeFirstName).not.toContain(" ");
      }
    }
    expect(overview.recurringRules.length).toBeGreaterThan(0);
    for (const rule of overview.recurringRules) {
      expect(rule).not.toHaveProperty("assigneeId");
    }
  });

  // ── Waiting on you (§12) ──

  it("exposes only the client-facing note field on parked rows", async () => {
    const items = await getWaitingOnYou(alison, blueSpruceId);
    expect(items.length).toBeGreaterThan(0);
    const feed = items.find((i) => i.kind === "bank_feed");
    expect(feed).toBeDefined();
    expect(feed!.note).toContain("bank statements");
    for (const item of items) {
      // The complete key set: nothing internal can leak by construction.
      expect(Object.keys(item).sort()).toEqual(
        ["attributedMonth", "attributedYear", "id", "kind", "neededFromClient", "note", "title"].sort(),
      );
    }
  });

  // ── Profile + change requests (§12) ──

  it("allows client-role direct edits of contact fields only", async () => {
    const updated = await updatePortalProfile(alison, harborlineId, {
      phone: "503-555-0100",
      city: "Astoria",
    });
    expect(updated!.phone).toBe("503-555-0100");
    expect(updated!.city).toBe("Astoria");
    await expect(updatePortalProfile(alison, harborlineId, {})).rejects.toMatchObject({
      status: 400,
    });
    // CPAs may not direct-edit profile fields (their write list is four places).
    await expect(
      updatePortalProfile(carlos, harborlineId, { phone: "503-555-0101" }),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);
  });

  it("creates change requests and supersedes a pending request for the same field", async () => {
    const first = await requestPortalChange(alison, harborlineId, "tax_structure", "S-corp");
    expect(first.status).toBe("pending");

    const second = await requestPortalChange(alison, harborlineId, "tax_structure", "LLC");
    const rows = await db
      .select()
      .from(portalChangeRequests)
      .where(
        and(
          eq(portalChangeRequests.clientId, harborlineId),
          eq(portalChangeRequests.fieldName, "tax_structure"),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(first.id)!.status).toBe("cancelled"); // superseded
    expect(byId.get(second.id)!.status).toBe("pending");
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(1);
  });

  it("scopes changeable fields by role (§12)", async () => {
    // Client role: tax_structure, bookkeeping_frequency, billing_frequency.
    await expect(
      requestPortalChange(alison, harborlineId, "tax_id", "93-0000000"),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);
    await expect(
      requestPortalChange(alison, harborlineId, "accounting_method", "cash"),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);
    const okClient = await requestPortalChange(alison, harborlineId, "billing_frequency", "quarterly");
    expect(okClient.status).toBe("pending");

    // CPA role: tax_structure, tax_id, accounting_method.
    await expect(
      requestPortalChange(carlos, harborlineId, "billing_frequency", "monthly"),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);
    const okCpa = await requestPortalChange(carlos, harborlineId, "accounting_method", "accrual");
    expect(okCpa.status).toBe("pending");

    const profile = await getPortalProfile(alison, harborlineId);
    expect(profile.pendingChangeRequests.length).toBeGreaterThan(0);
    expect(profile.canEditContact).toBe(true);
    const cpaProfile = await getPortalProfile(carlos, harborlineId);
    expect(cpaProfile.canEditContact).toBe(false);
  });

  // ── Portal requests (§12) ──

  it("mints a 7-day-lead ad-hoc task for the bookkeeper, attributed to the current work period", async () => {
    const task = await createPortalRequest(
      alison,
      harborlineId,
      "document",
      "Please send the Q2 P&L",
      TEST_TODAY,
    );
    expect(task.taskType).toBe("ad_hoc");
    expect(task.assigneeId).toBe(jorgeId);
    expect(task.createdById).toBe(alison.id);
    const expectedDue = addDays(TEST_TODAY, 7);
    expect(task.dueDate).toBe("2026-08-22");
    const period = workPeriodForDue(expectedDue);
    expect(task.attributedYear).toBe(period.year);
    expect(task.attributedMonth).toBe(period.month);

    // §12 parity with the upload rule: bookkeeper AND manager are notified.
    const notices = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.entityType, "task"), eq(notifications.entityId, task.id)));
    expect(notices.map((n) => n.userId).sort()).toEqual([danaId, jorgeId].sort());
    expect(notices.every((n) => n.notificationType === "portal_request")).toBe(true);
  });

  it("restricts request kinds by role (§12: CPA writes in exactly four places)", async () => {
    // Client role cannot mint tax-document requests; CPA cannot mint plain
    // document requests (tax-document and team requests only).
    await expect(
      createPortalRequest(alison, harborlineId, "tax_document", "need 1120S"),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);
    await expect(
      createPortalRequest(carlos, harborlineId, "document", "need docs"),
    ).rejects.toBeInstanceOf(PortalAccessDeniedError);

    const team = await createPortalRequest(alison, harborlineId, "team", "Please call me", TEST_TODAY);
    expect(team.taskType).toBe("ad_hoc");
    const taxDoc = await createPortalRequest(
      carlos,
      harborlineId,
      "tax_document",
      "Need the prior-year 1120S",
      TEST_TODAY,
    );
    expect(taxDoc.assigneeId).toBe(jorgeId);
  });

  // ── CPA surface (§12) ──

  it("lists CPA clients with cadence, monthly and quarterly", async () => {
    const list = await getCpaClients(carlos);
    expect(list).toEqual([
      { id: copperlineId, name: "Copperline Coffee Roasters", bookkeepingFrequency: "quarterly" },
      { id: harborlineId, name: "Harborline Marine Supply", bookkeepingFrequency: "monthly" },
    ]);
  });

  it("returns read-only CPA client detail with report and statement data shapes", async () => {
    const detail = await getCpaClientDetail(carlos, harborlineId);
    expect(detail.client.legalName).toBe("Harborline Marine Supply");
    expect(detail.reports.length).toBeGreaterThan(0);
    for (const report of detail.reports) {
      expect(report).not.toHaveProperty("completedById");
      expect(typeof report.isComplete).toBe("boolean");
    }
    // Harborline seeds three statement-bearing accounts.
    expect(detail.statements).toHaveLength(3);
    for (const statement of detail.statements) {
      expect(statement.statementDay).not.toBeNull();
    }
  });

  // ── Kill switch (§12) ──

  it("throws a not-found-shaped error when the portal is disabled", async () => {
    const prev = process.env.FIRMOS_PORTAL_ENABLED;
    delete process.env.FIRMOS_PORTAL_ENABLED;
    try {
      expect(await isPortalEnabled()).toBe(false);
      await expect(getWaitingOnYou(alison, blueSpruceId)).rejects.toBeInstanceOf(
        PortalDisabledError,
      );
      await expect(getWaitingOnYou(alison, blueSpruceId)).rejects.toMatchObject({ status: 404 });
      await expect(getPortalContext(alison)).rejects.toBeInstanceOf(PortalDisabledError);

      // The app_settings feature flag is the second leg of the switch.
      await db
        .insert(appSettings)
        .values({ key: "feature_flags", value: { client_portal_enabled: true } })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: { client_portal_enabled: true } } });
      try {
        expect(await isPortalEnabled()).toBe(true);
      } finally {
        await db.delete(appSettings).where(eq(appSettings.key, "feature_flags"));
      }
    } finally {
      if (prev === undefined) delete process.env.FIRMOS_PORTAL_ENABLED;
      else process.env.FIRMOS_PORTAL_ENABLED = prev;
    }
  });

  // ── Magic-link portal auth (§12) ──

  it("sends a magic link to a portal-role user and never to staff or unknown addresses", async () => {
    const res = await auth.api.signInMagicLink({
      body: { email: CLIENT_EMAIL },
      headers: new Headers(),
    });
    expect(res).toMatchObject({ status: true });
    const link = getLastMagicLink(CLIENT_EMAIL);
    expect(link).toBeTruthy();
    expect(link).toContain("/magic-link/verify?token=");

    // Same response shape for staff and unknown addresses: no enumeration,
    // and no link is ever sent (nothing stashed by the dev driver).
    const staffRes = await auth.api.signInMagicLink({
      body: { email: OWNER_EMAIL },
      headers: new Headers(),
    });
    expect(staffRes).toMatchObject({ status: true });
    expect(getLastMagicLink(OWNER_EMAIL)).toBeNull();

    const unknownRes = await auth.api.signInMagicLink({
      body: { email: "nobody@example.com" },
      headers: new Headers(),
    });
    expect(unknownRes).toMatchObject({ status: true });
    expect(getLastMagicLink("nobody@example.com")).toBeNull();
  });

  it("verifies a portal magic link into a session", async () => {
    await auth.api.signInMagicLink({ body: { email: CLIENT_EMAIL }, headers: new Headers() });
    const link = getLastMagicLink(CLIENT_EMAIL)!;
    const token = new URL(link).searchParams.get("token")!;
    const res = await auth.api.magicLinkVerify({
      query: { token, callbackURL: "/portal" },
      headers: new Headers(),
      asResponse: true,
    });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const cookies = res.headers.getSetCookie().join("; ");
    expect(cookies).toContain("better-auth.session_token");
  });

  it("rejects a magic-link token that resolves to a staff account at verify time", async () => {
    // Defense in depth: even a structurally valid token is refused when the
    // email behind it is not an active client/cpa account.
    const token = "staff-token-should-never-verify";
    await db.insert(authVerifications).values({
      identifier: token,
      value: JSON.stringify({ email: OWNER_EMAIL }),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    const outcome = await auth.api
      .magicLinkVerify({
        query: { token, callbackURL: "/portal" },
        headers: new Headers(),
        asResponse: true,
      })
      .then(
        (res) => ({ kind: "response" as const, res }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
    // Better Auth surfaces hook failures as a thrown APIError on direct
    // auth.api calls and as an error Response over HTTP; both must mean "no
    // session was minted".
    if (outcome.kind === "response") {
      expect(outcome.res.status).toBeGreaterThanOrEqual(400);
      expect(outcome.res.headers.getSetCookie().join("; ")).not.toContain(
        "better-auth.session_token",
      );
    } else {
      expect(outcome.error).toMatchObject({
        message: "This sign-in link is not valid for a portal account.",
      });
    }
    const [session] = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, mara.id))
      .limit(1);
    expect(session).toBeUndefined();
    await db.delete(authVerifications).where(eq(authVerifications.identifier, token));
  });

  it("dev-links helper refuses to run without FIRMOS_DEV_LINKS=1", async () => {
    const prev = process.env.FIRMOS_DEV_LINKS;
    delete process.env.FIRMOS_DEV_LINKS;
    try {
      expect(() => getLastMagicLink(CLIENT_EMAIL)).toThrow(/FIRMOS_DEV_LINKS/);
    } finally {
      if (prev === undefined) delete process.env.FIRMOS_DEV_LINKS;
      else process.env.FIRMOS_DEV_LINKS = prev;
    }
  });
});
