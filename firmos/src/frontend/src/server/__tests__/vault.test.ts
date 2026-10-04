import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  accounts,
  auditEvents,
  clientCredentials,
  clients,
  contactClientLinks,
  correspondence,
  credentialAccessEvents,
  users,
} from "@/db/schema";
import { toSessionUser, type SessionUser } from "@/server/auth/guards";
import { convertIntakeToClient } from "@/server/convert";
import { computeMissingInfoReminders } from "@/server/correspondence";
import { createIntake, submitIntakeForReview, updateIntake, type IntakePatch } from "@/server/intake";
import { missingInfoReminderJob } from "@/server/jobs";
import { PortalAccessDeniedError, PortalDisabledError } from "@/server/portal";
import { seedDatabase } from "@/server/seed";
import {
  archiveCredential,
  copyCredentialSecret,
  COPY_RATE_LIMIT_PER_MINUTE,
  createStaffCredential,
  getStaffCredentialDetail,
  listClientCredentials,
  listPortalCredentials,
  portalArchiveCredential,
  portalSaveCredential,
  purgeCredential,
  updateStaffCredential,
  VaultError,
} from "@/server/vault";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * Credential vault (Phase 3B): the authz matrix, copy-on-use auditing +
 * rate limit, conversion expectation seeding, the reminder-job reason with
 * dedup, the portal kill switch, and archive/purge semantics. Plaintext only
 * ever appears inside copyCredentialSecret's return; every assertion about
 * reads checks the secret is ABSENT.
 */

const reachable = await dbReachable();

let mara: SessionUser; // owner
let theo: SessionUser; // admin
let dana: SessionUser; // manager
let jorge: SessionUser; // bookkeeper
let alison: SessionUser; // client (Harborline, Blue Spruce, Riverstone)
let carlos: SessionUser; // cpa (Harborline, Copperline)
let harborlineId: number;
let blueSpruceId: number;
let copperlineId: number; // NOT linked to alison

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

async function accessEventCount(credentialId: number, action: string): Promise<number> {
  const rows = await db
    .select({ id: credentialAccessEvents.id })
    .from(credentialAccessEvents)
    .where(
      and(eq(credentialAccessEvents.credentialId, credentialId), eq(credentialAccessEvents.action, action)),
    );
  return rows.length;
}

async function reviewableIntake(patch: IntakePatch): Promise<number> {
  const row = await createIntake(patch);
  await updateIntake(row.id, {});
  await submitIntakeForReview(row.id);
  return row.id;
}

describe.skipIf(!reachable)("credential vault (Phase 3B)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    savedEnv.FIRMOS_PORTAL_ENABLED = process.env.FIRMOS_PORTAL_ENABLED;
    process.env.FIRMOS_PORTAL_ENABLED = "1";
    await seedDatabase(TEST_TODAY);
    mara = await sessionUserByEmail("mara@blueledgerbooks.com");
    theo = await sessionUserByEmail("theo@blueledgerbooks.com");
    dana = await sessionUserByEmail("dana@blueledgerbooks.com");
    jorge = await sessionUserByEmail("jorge@blueledgerbooks.com");
    alison = await sessionUserByEmail("alison@harborlinemarine.com");
    carlos = await sessionUserByEmail("carlos@riverstonetax.com");
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

  // ── Staff CRUD + role matrix ──

  it("owner/admin create+edit+archive; manager and bookkeeper cannot write", async () => {
    const created = await createStaffCredential(mara, harborlineId, {
      label: "Chase operating",
      institution: "Chase",
      loginUrl: "https://www.chase.com",
      username: "harborline-ops",
      secret: "correct-horse-battery-staple",
    });
    expect(created.status).toBe("filled");
    expect(created.createdVia).toBe("staff");
    // The masked read model carries nothing secret-shaped.
    expect(JSON.stringify(created)).not.toContain("correct-horse");
    expect("secretPacked" in created).toBe(false);

    // Admin can edit; the secret stays when none is supplied.
    const edited = await updateStaffCredential(theo, created.id, { username: "ops@harborline" });
    expect(edited.username).toBe("ops@harborline");
    const copy = await copyCredentialSecret(jorge, created.id);
    expect(copy.secret).toBe("correct-horse-battery-staple");

    // Manager/bookkeeper writes are rejected by the §11 role gate.
    await expect(createStaffCredential(dana, harborlineId, { label: "X", secret: "y" })).rejects.toThrow(
      /Requires one of: owner, admin/,
    );
    await expect(updateStaffCredential(jorge, created.id, { label: "Nope" })).rejects.toThrow(
      /Requires one of: owner, admin/,
    );
    await expect(archiveCredential(dana, created.id)).rejects.toThrow(/Requires one of: owner, admin/);

    // created/updated events + the global audit trail both exist.
    expect(await accessEventCount(created.id, "created")).toBe(1);
    expect(await accessEventCount(created.id, "updated")).toBe(1);
    const audit = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, "client_credential"), eq(auditEvents.entityId, created.id)))
      .orderBy(desc(auditEvents.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["credential_created", "credential_updated", "credential_copied_secret"]),
    );
    // No audit metadata may carry the secret.
    expect(JSON.stringify(audit.map((a) => a.details))).not.toContain("correct-horse");
  });

  it("any staff role lists + copies, but the list never contains the secret", async () => {
    const created = await createStaffCredential(theo, harborlineId, {
      label: "QuickBooks Online",
      institution: "Intuit",
      username: "books@harborline.com",
      secret: "qbo-s3cret!",
    });
    const list = await listClientCredentials(jorge, harborlineId);
    const row = list.items.find((i) => i.id === created.id);
    expect(row).toBeDefined();
    expect(row!.username).toBe("books@harborline.com");
    expect(JSON.stringify(list)).not.toContain("qbo-s3cret");

    // Copy returns exactly the secret and is audited.
    const copy = await copyCredentialSecret(jorge, created.id);
    expect(copy.secret).toBe("qbo-s3cret!");
    expect(await accessEventCount(created.id, "copied_secret")).toBe(1);
  });

  it("copy is rate-limited per user per minute", async () => {
    const sofia = await sessionUserByEmail("sofia@blueledgerbooks.com");
    const created = await createStaffCredential(mara, harborlineId, {
      label: "Rate limit probe",
      secret: "probe-secret",
    });
    // Sofia has no copies yet; t0 rides the real clock so earlier tests'
    // copies (also real-clock) belong to other users and never intersect.
    const t0 = new Date();
    for (let i = 0; i < COPY_RATE_LIMIT_PER_MINUTE; i++) {
      const copy = await copyCredentialSecret(sofia, created.id, new Date(t0.getTime() + i * 1000));
      expect(copy.secret).toBe("probe-secret");
    }
    await expect(
      copyCredentialSecret(sofia, created.id, new Date(t0.getTime() + 59_000)),
    ).rejects.toMatchObject({ status: 429 });
    // Another staff member still copies fine (the limit is per user).
    const other = await copyCredentialSecret(dana, created.id, new Date(t0.getTime() + 59_500));
    expect(other.secret).toBe("probe-secret");
    // After the window slides past the oldest copies, copying works again.
    const later = await copyCredentialSecret(sofia, created.id, new Date(t0.getTime() + 61_000));
    expect(later.secret).toBe("probe-secret");
  });

  it("opening the staff detail is the audited viewed_username event", async () => {
    const created = await createStaffCredential(mara, harborlineId, {
      label: "Detail probe",
      username: "detail-user",
      secret: "detail-secret",
    });
    const detail = await getStaffCredentialDetail(jorge, created.id);
    expect(detail.item.username).toBe("detail-user");
    expect(JSON.stringify(detail)).not.toContain("detail-secret");
    expect(detail.recentAccess.some((e) => e.action === "viewed_username")).toBe(true);
    expect(await accessEventCount(created.id, "viewed_username")).toBe(1);
  });

  // ── Archive / purge semantics ──

  it("archive is a soft delete; purge is owner-only and needs the archive first", async () => {
    const created = await createStaffCredential(mara, harborlineId, {
      label: "Archive me",
      secret: "archive-secret",
    });

    // Purge requires archive-first, and is owner-only.
    await expect(purgeCredential(mara, created.id)).rejects.toMatchObject({ status: 409 });
    await expect(archiveCredential(theo, created.id)).resolves.toBeUndefined();
    await expect(archiveCredential(theo, created.id)).rejects.toMatchObject({ status: 409 });

    // Archived rows leave the default list and refuse copies.
    const list = await listClientCredentials(mara, harborlineId);
    expect(list.items.some((i) => i.id === created.id)).toBe(false);
    await expect(copyCredentialSecret(jorge, created.id)).rejects.toMatchObject({ status: 404 });
    // ...but the owner sees them in the includeArchived purge review.
    const withArchived = await listClientCredentials(mara, harborlineId, { includeArchived: true });
    expect(withArchived.items.find((i) => i.id === created.id)?.archivedAt).not.toBeNull();

    await expect(purgeCredential(theo, created.id)).rejects.toThrow(/Requires one of: owner/);
    await purgeCredential(mara, created.id);
    const gone = await db
      .select({ id: clientCredentials.id })
      .from(clientCredentials)
      .where(eq(clientCredentials.id, created.id));
    expect(gone).toHaveLength(0);
    // The per-credential trail cascaded; the global audit log kept the purge.
    const audit = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "credential_purged"), eq(auditEvents.entityId, created.id)));
    expect(audit).toHaveLength(1);
  });

  // ── Portal self-entry + IDOR ──

  it("portal: the client adds, fills expected slots, edits/removes their own - all audited", async () => {
    // A conversion-seeded expected slot (createdVia system, no secret).
    const [slotAccount] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.clientId, harborlineId))
      .limit(1);
    const [slot] = await db
      .insert(clientCredentials)
      .values({
        clientId: harborlineId,
        accountId: slotAccount.id,
        label: "Chase checking",
        institution: "Chase",
        createdById: mara.id,
        createdVia: "system",
      })
      .returning();

    const before = await listPortalCredentials(alison, harborlineId);
    expect(before.expected.map((e) => e.id)).toContain(slot.id);

    // Fill the expected slot (the 01:20:02 flow) - no label change needed.
    const filled = await portalSaveCredential(alison, harborlineId, {
      id: slot.id,
      username: "alison-brewer",
      secret: "portal-supplied-secret",
      loginUrl: "https://www.chase.com",
    });
    expect(filled.status).toBe("filled");
    expect(JSON.stringify(filled)).not.toContain("portal-supplied");
    expect(await accessEventCount(slot.id, "updated")).toBe(1);

    // Portal create.
    const mine = await portalSaveCredential(alison, harborlineId, {
      label: "Gusto payroll",
      institution: "Gusto",
      username: "alison@harborlinemarine.com",
      secret: "gusto-secret",
    });
    expect(mine.createdVia).toBe("portal");

    // A staff-created filled row is not portal-editable (not alison's own).
    const staffRow = await createStaffCredential(mara, harborlineId, {
      label: "Staff-entered login",
      secret: "staff-secret",
    });
    await expect(
      portalSaveCredential(alison, harborlineId, { id: staffRow.id, username: "hijack" }),
    ).rejects.toMatchObject({ status: 403 });

    // Remove her own entry; the expected-slot-turned-saved row is not hers
    // to remove (system-created), so it refuses with 403.
    await expect(portalArchiveCredential(alison, harborlineId, slot.id)).rejects.toMatchObject({
      status: 403,
    });
    await portalArchiveCredential(alison, harborlineId, mine.id);
    const after = await listPortalCredentials(alison, harborlineId);
    expect(after.saved.some((i) => i.id === mine.id)).toBe(false);
    expect(after.saved.some((i) => i.id === slot.id)).toBe(true);

    // Every portal write is audit-logged with the portal user's identity.
    const portalAudit = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, "client_credential"), eq(auditEvents.entityId, slot.id)));
    expect(portalAudit.some((a) => a.userId === alison.id && a.action === "credential_updated")).toBe(true);
  });

  it("portal: cross-client credential ids answer 404, never a 403 existence leak", async () => {
    // Copperline is NOT linked to alison; a Harborline-scoped op on a
    // Copperline credential id must look like the row does not exist.
    const foreign = await createStaffCredential(mara, copperlineId, {
      label: "Copperline bank",
      secret: "foreign-secret",
    });
    await expect(
      portalSaveCredential(alison, harborlineId, { id: foreign.id, username: "x", secret: "y" }),
    ).rejects.toMatchObject({ status: 404, name: "VaultError" });
    await expect(portalArchiveCredential(alison, harborlineId, foreign.id)).rejects.toMatchObject({
      status: 404,
    });
    // And the client-level membership check still rejects the foreign client.
    await expect(listPortalCredentials(alison, copperlineId)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
    // The CPA role has no vault surface at all.
    await expect(listPortalCredentials(carlos, harborlineId)).rejects.toBeInstanceOf(
      PortalAccessDeniedError,
    );
  });

  it("portal: the §12 kill switch 404s the vault when the portal is off", async () => {
    delete process.env.FIRMOS_PORTAL_ENABLED;
    try {
      await expect(listPortalCredentials(alison, harborlineId)).rejects.toBeInstanceOf(
        PortalDisabledError,
      );
      await expect(
        portalSaveCredential(alison, harborlineId, { label: "x", secret: "y" }),
      ).rejects.toBeInstanceOf(PortalDisabledError);
    } finally {
      process.env.FIRMOS_PORTAL_ENABLED = "1";
    }
  });

  // ── Conversion expectation seeding (01:18:40) ──

  it("conversion opens one expected slot per 'grant us login access' account", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Vault Seeding Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [
          { name: "Chase Operating", accountType: "checking", institution: "Chase", last4: "4411", grantLoginAccess: true },
          { name: "Amex Gold", accountType: "credit_card", institution: "Amex", last4: "1005" },
          { name: "QBO Payroll", accountType: "payroll_liability", institution: "Intuit", grantLoginAccess: true },
        ],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, mara.id, TEST_TODAY);
    expect(result.credentialsExpectedCreated).toBe(2);

    const rows = await db
      .select()
      .from(clientCredentials)
      .where(eq(clientCredentials.clientId, result.clientId))
      .orderBy(clientCredentials.label);
    expect(rows).toHaveLength(2);
    // With a last-4, the label follows the bank -> type -> last4 standard (D2).
    expect(rows.map((r) => r.label)).toEqual(["Chase Checking · 4411", "QBO Payroll"]);
    for (const row of rows) {
      expect(row.secretPacked).toBeNull(); // expected = unfilled
      expect(row.createdVia).toBe("system");
      expect(row.createdById).toBe(mara.id);
      expect(row.accountId).not.toBeNull(); // linked to the chart-side account
    }
    // The link lands on the account of the same name.
    const chaseAccount = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.clientId, result.clientId), eq(accounts.name, "Chase Operating")));
    expect(rows[0].accountId).toBe(chaseAccount[0].id);

    // Vault status drives the badge: 2 expected, 0 filled.
    const list = await listClientCredentials(mara, result.clientId);
    expect(list.missingCount).toBe(2);
  });

  // ── Reminder job: "credentials missing" reason + dedup (01:22:08) ──

  it("the missing-info reminder itemizes unfilled vault slots and dedupes on cadence", async () => {
    const now = new Date();
    // Fresh client with a contact email and one unfilled slot.
    const [client] = await db
      .insert(clients)
      .values({ legalName: "Vault Reminder Co", bookkeepingFrequency: "monthly" })
      .returning();
    const contactId = alison.contactId!;
    await db
      .insert(contactClientLinks)
      .values({ contactId, clientId: client.id, relationshipType: "primary_contact" });
    await db.update(clients).set({ primaryContactId: contactId }).where(eq(clients.id, client.id));
    await db.insert(clientCredentials).values({
      clientId: client.id,
      label: "Chase checking",
      institution: "Chase",
      createdById: mara.id,
      createdVia: "system",
    });

    const { plans } = await computeMissingInfoReminders(now);
    const plan = plans.find((p) => p.clientId === client.id);
    expect(plan).toBeDefined();
    const credentialReasons = plan!.reasons.filter((r) => r.includes("Chase checking"));
    expect(credentialReasons).toHaveLength(1);
    expect(credentialReasons[0]).toContain("secure portal vault");

    const first = await missingInfoReminderJob(now);
    expect(first.remindersSent).toBeGreaterThanOrEqual(1);
    const [mail] = await db
      .select()
      .from(correspondence)
      .where(
        and(eq(correspondence.clientId, client.id), eq(correspondence.template, "missing_info_reminder")),
      );
    expect(mail.bodyText).toContain("Chase checking");

    // Same-day rerun dedupes on cadence.
    const second = await missingInfoReminderJob(now);
    expect(second.skipped.some((s) => s.clientId === client.id && s.reason === "cadence")).toBe(true);

    // Filling the slot removes the reason (no other reasons apply here: the
    // client is brand-new, so the portal-activation grace period shields it).
    const [slotRow] = await db
      .select()
      .from(clientCredentials)
      .where(eq(clientCredentials.clientId, client.id));
    await portalSaveCredential(alison, client.id, {
      id: slotRow.id,
      username: "owner@vault-reminder.co",
      secret: "filled-secret",
    });
    const { plans: afterPlans } = await computeMissingInfoReminders(now);
    const after = afterPlans.find((p) => p.clientId === client.id);
    expect(after?.reasons.some((r) => r.includes("Chase checking")) ?? false).toBe(false);
  });
});
