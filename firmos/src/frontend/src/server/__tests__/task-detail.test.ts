import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  accounts,
  clientManualEntries,
  clientReports,
  clients,
  documents,
  recurringTaskSopLinks,
  recurringTasks,
  sopTemplates,
  taskSubtasks,
  tasks,
  users,
} from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import { addTaskNote, getReportCardDetail, getTaskDetail, setSubtaskCompleted } from "@/server/task-detail";
import {
  applySopToClient,
  autoLinkInstitutionSops,
  createSopTemplate,
  normalizeInstitutionKey,
} from "@/server/templates";

import { dbReachable, TEST_TODAY } from "./helpers";

// requireStaff reads the HTTP session, which does not exist under vitest;
// the guard is exercised in the actions layer and the auth tests. The
// resolved user feeds the drawer's canFlagStale decision, so the mock
// resolves an owner-shaped staff user (not undefined).
vi.mock("@/server/auth/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/guards")>();
  return {
    ...actual,
    requireStaff: vi.fn(async () => ({ normalizedRole: "owner", canEditSops: true })),
  };
});

const reachable = await dbReachable();

const ADMIN = "theo@blueledgerbooks.com";

let theoId: number;
let harborlineId: number;
let reconcileRuleId: number;
let ruleTaskId: number;

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return row.id;
}

describe.skipIf(!reachable)("task detail engine + SOP institution auto-linking", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    theoId = await userIdByEmail(ADMIN);
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.legalName, "Harborline Marine Supply"))
      .limit(1);
    harborlineId = client.id;

    const [rule] = await db
      .select()
      .from(recurringTasks)
      .where(and(eq(recurringTasks.clientId, harborlineId), eq(recurringTasks.title, "Reconcile Accounts")))
      .limit(1);
    if (!rule) throw new Error("seeded Reconcile Accounts rule not found");
    reconcileRuleId = rule.id;

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.recurringTaskId, reconcileRuleId))
      .limit(1);
    if (!task) throw new Error("no materialized task for the reconcile rule");
    ruleTaskId = task.id;
  });

  // ── getTaskDetail: the drawer payload ─────────────────────────────────

  it("resolves SOPs linked through the recurring rule and directly to the task", async () => {
    const ruleSop = await createSopTemplate(theoId, {
      title: "Columbia Bank reconciliation",
      content: "1. Pull the statement\n2. Match cleared items\nhttps://www.loom.com/share/abc123",
      institutionKey: "Columbia Bank",
      changeNote: "Added the walkthrough video.",
    });
    await db.insert(recurringTaskSopLinks).values({ sopTemplateId: ruleSop.id, recurringTaskId: reconcileRuleId });

    const directSop = await createSopTemplate(theoId, { title: "One-off cleanup SOP", content: "Call the client." });
    await db.insert(recurringTaskSopLinks).values({ sopTemplateId: directSop.id, taskId: ruleTaskId });

    const unrelated = await createSopTemplate(theoId, { title: "Unrelated SOP" });

    const detail = await getTaskDetail(ruleTaskId, TEST_TODAY);

    expect(detail.task.id).toBe(ruleTaskId);
    expect(detail.task.clientId).toBe(harborlineId);
    expect(detail.task.clientName).toBe("Harborline Marine Supply");
    expect(detail.today).toBe("2026-08-15");

    const sopIds = detail.sops.map((s) => s.id);
    expect(sopIds).toContain(ruleSop.id);
    expect(sopIds).toContain(directSop.id);
    expect(sopIds).not.toContain(unrelated.id);

    const resolved = detail.sops.find((s) => s.id === ruleSop.id)!;
    expect(resolved.institutionKey).toBe("columbia bank");
    // The key names no institutions-table row (the list says "Columbia"),
    // so the pretty name stays null and the drawer falls back to the key.
    expect(resolved.institutionName).toBeNull();
    expect(resolved.changeNote).toBe("Added the walkthrough video.");
    expect(resolved.links).toEqual(["https://www.loom.com/share/abc123"]);
    expect(resolved.updatedAt).toBeTruthy();
    // Owner-shaped session: the drawer exposes the staleness flag.
    expect(detail.canFlagStale).toBe(true);
  });

  it("gathers subtasks and the notes thread, and mutations persist", async () => {
    await db.insert(taskSubtasks).values([
      { taskId: ruleTaskId, title: "Pull the statement", position: 0 },
      { taskId: ruleTaskId, title: "Match cleared items", position: 1 },
    ]);
    await addTaskNote(ruleTaskId, "Client sent the statement late.", theoId);

    const detail = await getTaskDetail(ruleTaskId);
    expect(detail.subtasks.map((s) => s.title)).toEqual(["Pull the statement", "Match cleared items"]);
    expect(detail.subtasks.every((s) => !s.isCompleted)).toBe(true);

    expect(detail.notes.length).toBe(1);
    expect(detail.notes[0].body).toBe("Client sent the statement late.");
    expect(detail.notes[0].authorName).toBe("Theo Park");

    const toggled = await setSubtaskCompleted(detail.subtasks[0].id, true, theoId);
    expect(toggled.isCompleted).toBe(true);
    expect(toggled.completedById).toBe(theoId);

    const after = await getTaskDetail(ruleTaskId);
    expect(after.subtasks.find((s) => s.id === toggled.id)?.isCompleted).toBe(true);

    await expect(addTaskNote(ruleTaskId, "   ", theoId)).rejects.toMatchObject({ status: 400 });
  });

  it("folds SOP-mirrored manual entries into the SOP cards, listing only standalone ones", async () => {
    const sop = await createSopTemplate(theoId, { title: "Mirrored procedure", content: "Do the thing." });
    await db.insert(recurringTaskSopLinks).values({ sopTemplateId: sop.id, taskId: ruleTaskId });
    await applySopToClient(theoId, sop.id, harborlineId);
    await db.insert(clientManualEntries).values({
      clientId: harborlineId,
      title: "Harborline-only quirk",
      content: "They round cash deposits.",
      position: 99,
    });

    const detail = await getTaskDetail(ruleTaskId);
    expect(detail.sops.map((s) => s.id)).toContain(sop.id);
    // The mirror of a shown SOP is not duplicated into the manual list.
    expect(detail.manualEntries.map((m) => m.title)).not.toContain("Mirrored procedure");
    expect(detail.manualEntries.map((m) => m.title)).toContain("Harborline-only quirk");
  });

  // ── autoLinkInstitutionSops ────────────────────────────────────────────

  it("links an institution-keyed SOP to the client manual and reconciliation rules", async () => {
    await db.insert(accounts).values({
      clientId: harborlineId,
      name: "Fleet Card",
      accountType: "credit_card",
      institution: "Chevron WEX",
      statementDay: 31,
    });
    const sop = await createSopTemplate(theoId, {
      title: "Chevron WEX fuel card close",
      content: "1. Download the WEX statement\n2. Code fuel by vehicle",
      institutionKey: "Chevron WEX",
    });
    // Stored normalized for case-insensitive matching.
    const [stored] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, sop.id)).limit(1);
    expect(stored.institutionKey).toBe("chevron wex");

    const result = await autoLinkInstitutionSops(harborlineId, theoId);
    expect(result.matchedSops).toBe(1);
    expect(result.manualEntriesCreated).toBe(1);
    // Only "Reconcile Accounts" matches the bank/credit rule target.
    expect(result.ruleLinksCreated).toBe(1);

    const [mirror] = await db
      .select()
      .from(clientManualEntries)
      .where(and(eq(clientManualEntries.clientId, harborlineId), eq(clientManualEntries.sopTemplateId, sop.id)))
      .limit(1);
    expect(mirror.title).toBe("Chevron WEX fuel card close");
    expect(mirror.content).toBe(sop.content);

    const links = await db
      .select()
      .from(recurringTaskSopLinks)
      .where(eq(recurringTaskSopLinks.sopTemplateId, sop.id));
    expect(links.some((l) => l.clientManualEntryId === mirror.id)).toBe(true);
    expect(links.some((l) => l.recurringTaskId === reconcileRuleId)).toBe(true);

    // Idempotent: a second run creates nothing new.
    const again = await autoLinkInstitutionSops(harborlineId, theoId);
    expect(again).toEqual({ matchedSops: 1, manualEntriesCreated: 0, ruleLinksCreated: 0 });
  });

  it("matches institutions case-insensitively", async () => {
    expect(normalizeInstitutionKey("  AmEx ")).toBe("amex");
    await db.insert(accounts).values({
      clientId: harborlineId,
      name: "Corporate Card",
      accountType: "credit_card",
      institution: "AMEX",
      statementDay: 31,
    });
    const sop = await createSopTemplate(theoId, { title: "Amex close", institutionKey: "AmEx" });

    const result = await autoLinkInstitutionSops(harborlineId, theoId);
    expect(result.matchedSops).toBeGreaterThanOrEqual(1);
    const links = await db
      .select()
      .from(recurringTaskSopLinks)
      .where(eq(recurringTaskSopLinks.sopTemplateId, sop.id));
    expect(links.some((l) => l.recurringTaskId === reconcileRuleId)).toBe(true);
  });

  it("targets merchant recon rules for merchant institutions", async () => {
    const [merchantRule] = await db
      .insert(recurringTasks)
      .values({
        clientId: harborlineId,
        title: "Merchant payout reconciliation",
        scheduleType: "monthly",
        dayOfMonth: 5,
        isCustom: true,
      })
      .returning();
    await db.insert(accounts).values({
      clientId: harborlineId,
      name: "Stripe",
      accountType: "merchant",
      institution: "Stripe",
      statementDay: 31,
    });
    const sop = await createSopTemplate(theoId, { title: "Stripe payout SOP", institutionKey: "stripe" });

    await autoLinkInstitutionSops(harborlineId, theoId);
    const links = await db
      .select()
      .from(recurringTaskSopLinks)
      .where(eq(recurringTaskSopLinks.sopTemplateId, sop.id));
    expect(links.some((l) => l.recurringTaskId === merchantRule.id)).toBe(true);
    // Merchant institutions never link to the plain bank reconciliation rule.
    expect(links.some((l) => l.recurringTaskId === reconcileRuleId)).toBe(false);
  });

  it("is a no-op when no institution matches", async () => {
    const sop = await createSopTemplate(theoId, { title: "Nowhere Bank SOP", institutionKey: "nowhere bank" });
    await autoLinkInstitutionSops(harborlineId, theoId);
    const links = await db
      .select()
      .from(recurringTaskSopLinks)
      .where(eq(recurringTaskSopLinks.sopTemplateId, sop.id));
    expect(links.length).toBe(0);
    const mirrors = await db
      .select()
      .from(clientManualEntries)
      .where(eq(clientManualEntries.sopTemplateId, sop.id));
    expect(mirrors.length).toBe(0);
  });

  it("ignores inactive SOP templates", async () => {
    const sop = await createSopTemplate(theoId, { title: "Retired WEX SOP", institutionKey: "chevron wex" });
    await db.update(sopTemplates).set({ isActive: false }).where(eq(sopTemplates.id, sop.id));
    await autoLinkInstitutionSops(harborlineId, theoId);
    const links = await db
      .select()
      .from(recurringTaskSopLinks)
      .where(eq(recurringTaskSopLinks.sopTemplateId, sop.id));
    expect(links.length).toBe(0);
  });

  // The drawer's report flow (01:39:05): report tasks carry the §6.3 gate
  // state so Complete can explain "upload the report file"; report cards get
  // their own light read for the upload surface.
  it("mirrors the report-document gate onto report tasks only", async () => {
    const [sendReports] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, harborlineId), eq(tasks.title, "Send Reports")))
      .limit(1);
    if (!sendReports) throw new Error("seeded Send Reports task not found");

    // No report file yet: the gate is up, pointing at the task's period.
    const gated = await getTaskDetail(sendReports.id, TEST_TODAY);
    expect(gated.reportGate).not.toBeNull();
    expect(gated.reportGate).toMatchObject({
      year: sendReports.attributedYear,
      month: sendReports.attributedMonth,
      documentUploaded: false,
      fileName: null,
    });

    await db.insert(documents).values({
      clientId: harborlineId,
      fileName: "financial-package.pdf",
      storedPath: `harborline-marine-supply/Documents/Reports/${sendReports.attributedYear}/gate-pin.pdf`,
      docType: "report",
      attributedYear: sendReports.attributedYear,
      attributedMonth: sendReports.attributedMonth,
      uploadedById: theoId,
    });

    const lifted = await getTaskDetail(sendReports.id, TEST_TODAY);
    expect(lifted.reportGate).toMatchObject({
      documentUploaded: true,
      fileName: "financial-package.pdf",
    });

    // A plain task never carries the gate.
    const plain = await getTaskDetail(ruleTaskId, TEST_TODAY);
    expect(plain.reportGate).toBeNull();
  });

  it("getReportCardDetail reads the row plus the period's report file", async () => {
    const [report] = await db
      .select()
      .from(clientReports)
      .where(eq(clientReports.clientId, harborlineId))
      .limit(1);
    if (!report) throw new Error("seeded report row not found");

    const before = await getReportCardDetail(report.id, TEST_TODAY);
    expect(before.kind).toBe("report");
    expect(before.clientId).toBe(harborlineId);
    expect(before.clientName).toBe("Harborline Marine Supply");
    expect(before.attributedYear).toBe(report.attributedYear);
    expect(before.attributedMonth).toBe(report.attributedMonth);
    expect(before.completedAt).toBeNull();
    expect(before.today).toBe("2026-08-15");

    // The period read falls back to the newest report document; the row's
    // own linked document wins once stamped.
    const [a] = await db
      .insert(documents)
      .values({
        clientId: harborlineId,
        fileName: "period-package.pdf",
        storedPath: `harborline-marine-supply/Documents/Reports/${report.attributedYear}/card-pin-a.pdf`,
        docType: "report",
        attributedYear: report.attributedYear,
        attributedMonth: report.attributedMonth,
        uploadedById: theoId,
      })
      .returning();
    const [b] = await db
      .insert(documents)
      .values({
        clientId: harborlineId,
        fileName: "linked-package.pdf",
        storedPath: `harborline-marine-supply/Documents/Reports/${report.attributedYear}/card-pin-b.pdf`,
        docType: "report",
        attributedYear: report.attributedYear,
        attributedMonth: report.attributedMonth,
        uploadedById: theoId,
      })
      .returning();
    await db.update(clientReports).set({ documentId: a.id }).where(eq(clientReports.id, report.id));

    const after = await getReportCardDetail(report.id, TEST_TODAY);
    expect(after.documentFileName).toBe("period-package.pdf");
    // The newest period doc would be b; the link still wins.
    expect(b.id).toBeGreaterThan(a.id);
  });
});
