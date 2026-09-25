import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  auditEvents,
  institutions,
  recurringTaskSopLinks,
  sopTemplates,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";
import { getInstitutionSopCoverage } from "@/server/admin-reads";
import { addInstitution } from "@/server/institutions";
import { getUnifiedQueue, type WorkCard } from "@/server/queue";
import { seedDatabase } from "@/server/seed";
import { getCurrentUserId } from "@/server/session";
import { getTaskDetail, getWorkCardSopDetail } from "@/server/task-detail";
import {
  autoLinkInstitutionSops,
  countAccountsByInstitutionKey,
  createSopTemplate,
  flagSopStale,
  matchInstitutionSops,
  normalizeInstitutionKey,
  normalizeSopInstitutionKeys,
  type SopTemplateRow,
} from "@/server/templates";

// requireStaff reads the HTTP session, which does not exist under vitest;
// resolve an owner-shaped staff user so the drawer's canFlagStale decision
// runs (the guard itself is exercised in the actions layer and auth tests).
vi.mock("@/server/auth/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/guards")>();
  return {
    ...actual,
    requireStaff: vi.fn(async () => ({ normalizedRole: "owner", canEditSops: true })),
  };
});

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

const ADMIN = "theo@blueledgerbooks.com";

let theoId: number;
let harborlineId: number;
let columbiaId: number;
let operatingAccountId: number;
let columbiaSop: SopTemplateRow;

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return row.id;
}

function allCards(queue: Awaited<ReturnType<typeof getUnifiedQueue>>): WorkCard[] {
  return Object.values(queue.buckets).flat();
}

describe.skipIf(!reachable)("I5 - bank SOP learning center (institution matching)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    theoId = await userIdByEmail(ADMIN);
    const allClients = await db.select().from(accounts);
    const operating = allClients.find((a) => a.name === "Operating Checking");
    if (!operating) throw new Error("seeded Operating Checking account not found");
    operatingAccountId = operating.id;
    harborlineId = operating.clientId;
    const [columbia] = await db
      .select()
      .from(institutions)
      .where(eq(institutions.name, "Columbia"))
      .limit(1);
    columbiaId = columbia.id;
    // Harborline banks with Columbia (the I3 dropdown pick).
    await db
      .update(accounts)
      .set({ institutionId: columbiaId, institution: "Columbia" })
      .where(eq(accounts.id, operatingAccountId));
    // Becky's SOP from a previous client, keyed to the bank.
    columbiaSop = await createSopTemplate(theoId, {
      title: "Columbia Bank portal walkthrough",
      content: "1. Log in to the Columbia portal\n2. Pull the statement PDF",
      institutionKey: "COLUMBIA",
    });
  });

  it("folds case and whitespace on both sides of the match", () => {
    expect(normalizeInstitutionKey("  Columbia   Bank ")).toBe("columbia bank");
    expect(normalizeInstitutionKey("AMEX")).toBe("amex");
    expect(normalizeInstitutionKey("   ")).toBeNull();
    // Keys are stored folded at write time.
    expect(columbiaSop.institutionKey).toBe("columbia");
    // Matching takes display names or keys in any casing/spacing.
    const matched = matchInstitutionSops([columbiaSop], ["  Columbia  "]);
    expect(matched.map((s) => s.id)).toEqual([columbiaSop.id]);
    expect(matchInstitutionSops([columbiaSop], ["Chase"])).toEqual([]);
  });

  it("auto-link resolves the bank through the institution FK, falling back to the text snapshot", async () => {
    // FK row whose text snapshot deliberately disagrees: the FK name wins.
    await db.insert(accounts).values({
      clientId: harborlineId,
      name: "FK Test Checking",
      accountType: "checking",
      institution: "Wrong Text Entirely",
      institutionId: columbiaId,
      statementDay: 31,
    });
    // Legacy row: free text only, differently cased and spaced.
    await db.insert(accounts).values({
      clientId: harborlineId,
      name: "Legacy Text Card",
      accountType: "credit_card",
      institution: "  AmEx ",
      statementDay: 31,
    });
    const amexSop = await createSopTemplate(theoId, { title: "Amex close", institutionKey: "amex" });

    const result = await autoLinkInstitutionSops(harborlineId, theoId);
    expect(result.matchedSops).toBeGreaterThanOrEqual(2);

    const links = await db
      .select()
      .from(recurringTaskSopLinks)
      .where(eq(recurringTaskSopLinks.sopTemplateId, columbiaSop.id));
    expect(links.length).toBeGreaterThan(0);
    const amexLinks = await db
      .select()
      .from(recurringTaskSopLinks)
      .where(eq(recurringTaskSopLinks.sopTemplateId, amexSop.id));
    expect(amexLinks.length).toBeGreaterThan(0);
  });

  it("counts institution SOPs on the feed and reconciliation cards", async () => {
    const queue = await getUnifiedQueue(await getCurrentUserId(), TEST_TODAY);
    const cards = allCards(queue);

    const recon = cards.find(
      (c) => c.kind === "reconciliation" && c.title === "Reconcile Operating Checking",
    );
    expect(recon).toBeDefined();
    expect(recon!.sopCount).toBe(1);

    // The client's weekly feed card carries the UNION of its banks' SOPs:
    // Columbia (FK rows) + Amex (legacy text) = 2 distinct SOPs.
    const feed = cards.find((c) => c.kind === "bank_feed" && c.clientId === harborlineId);
    expect(feed).toBeDefined();
    expect(feed!.sopCount).toBe(2);

    // An account with no bank shows a plain 0 - the quiet empty state.
    const noBank = cards.find(
      (c) => c.kind === "reconciliation" && c.title === "Reconcile Business Credit Card",
    );
    expect(noBank).toBeDefined();
    expect(noBank!.sopCount).toBe(0);

    // Task cards have no icon count; their SOPs live in the task drawer.
    const taskCard = cards.find((c) => c.kind === "task" && c.clientId === harborlineId);
    expect(taskCard).toBeDefined();
    expect(taskCard!.sopCount).toBeUndefined();
  });

  it("resolves the drawer SOP read for a reconciliation card", async () => {
    const [reconRow] = await db
      .select()
      .from(accountReconciliations)
      .where(and(eq(accountReconciliations.accountId, operatingAccountId), isNull(accountReconciliations.completedAt)))
      .limit(1);
    expect(reconRow).toBeDefined();

    const detail = await getWorkCardSopDetail("reconciliation", reconRow.id, TEST_TODAY);
    expect(detail.kind).toBe("reconciliation");
    expect(detail.title).toBe("Reconcile Operating Checking");
    expect(detail.institutionNames).toEqual(["Columbia"]);
    expect(detail.hasInstitution).toBe(true);
    expect(detail.sops.map((s) => s.id)).toEqual([columbiaSop.id]);
    expect(detail.sops[0].institutionName).toBe("Columbia");
    expect(detail.sops[0].changeNote).toBeNull();
    expect(detail.canFlagStale).toBe(true);
  });

  it("resolves the drawer SOP read for a bank-feed card across the client's banks", async () => {
    const [feedRow] = await db
      .select()
      .from(weeklyBankFeeds)
      .where(and(eq(weeklyBankFeeds.clientId, harborlineId), isNull(weeklyBankFeeds.completedAt)))
      .limit(1);
    expect(feedRow).toBeDefined();

    const detail = await getWorkCardSopDetail("bank_feed", feedRow.id, TEST_TODAY);
    expect(detail.kind).toBe("bank_feed");
    expect(detail.clientId).toBe(harborlineId);
    // Client-wide union: Columbia (FK rows) and Amex (legacy text) both match.
    expect(detail.sops.map((s) => s.id)).toContain(columbiaSop.id);
    expect(detail.sops.some((s) => s.institutionName === "Amex")).toBe(true);
    expect(detail.hasInstitution).toBe(true);
  });

  it("quiet empty state: a brand-new bank has no SOPs yet", async () => {
    const bank = await addInstitution("First Interstate Bank");
    const [newAccount] = await db
      .insert(accounts)
      .values({
        clientId: harborlineId,
        name: "New Bank Checking",
        accountType: "checking",
        institutionId: bank.id,
        statementDay: 31,
      })
      .returning();
    const [reconRow] = await db
      .insert(accountReconciliations)
      .values({
        accountId: newAccount.id,
        clientId: harborlineId,
        attributedYear: 2026,
        attributedMonth: 8,
        dueDate: "2026-09-05",
      })
      .returning();

    const detail = await getWorkCardSopDetail("reconciliation", reconRow.id, TEST_TODAY);
    expect(detail.sops).toEqual([]);
    expect(detail.hasInstitution).toBe(true);
    expect(detail.institutionNames).toEqual(["First Interstate Bank"]);

    // An account with no bank at all stays quiet too.
    const [noBankAccount] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, harborlineId), eq(accounts.name, "Business Credit Card")))
      .limit(1);
    const [noBankRecon] = await db
      .select()
      .from(accountReconciliations)
      .where(and(eq(accountReconciliations.accountId, noBankAccount.id), isNull(accountReconciliations.completedAt)))
      .limit(1);
    const noBank = await getWorkCardSopDetail("reconciliation", noBankRecon.id, TEST_TODAY);
    expect(noBank.sops).toEqual([]);
    expect(noBank.hasInstitution).toBe(false);
    expect(noBank.institutionNames).toEqual([]);
  });

  it("rejects an unknown card id with a 404", async () => {
    await expect(getWorkCardSopDetail("reconciliation", 999_999, TEST_TODAY)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("task-drawer SOPs carry the pretty bank name and the flag permission", async () => {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, harborlineId), isNull(tasks.deletedAt)))
      .limit(1);
    expect(task).toBeDefined();
    await db.insert(recurringTaskSopLinks).values({ sopTemplateId: columbiaSop.id, taskId: task.id });

    const detail = await getTaskDetail(task.id, TEST_TODAY);
    const sop = detail.sops.find((s) => s.id === columbiaSop.id)!;
    expect(sop.institutionName).toBe("Columbia");
    expect(detail.canFlagStale).toBe(true);
  });

  it("flagSopStale writes the changeNote marker without bumping updatedAt", async () => {
    const [before] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, columbiaSop.id)).limit(1);

    const flagged = await flagSopStale(theoId, columbiaSop.id);
    expect(flagged.changeNote).toBe("Flagged stale - needs a refresh");
    expect(flagged.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    const withReason = await flagSopStale(theoId, columbiaSop.id, "Portal redesign moved the export");
    expect(withReason.changeNote).toBe("Flagged stale - Portal redesign moved the export");

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "sop_flagged_stale"), eq(auditEvents.entityId, columbiaSop.id)))
      .limit(1);
    expect(event).toBeDefined();
  });

  it("counts active client accounts per institution key (FK + legacy text)", async () => {
    const counts = await countAccountsByInstitutionKey();
    // Operating Checking + FK Test Checking resolve through the Columbia FK.
    expect(counts.get("columbia")).toBe(2);
    // The legacy free-text Amex row folds in too.
    expect(counts.get("amex")).toBe(1);
    // The brand-new bank from the empty-state test.
    expect(counts.get("first interstate bank")).toBe(1);
  });

  it("coverage flags banks with accounts but no SOPs, leading the list", async () => {
    const rows = await getInstitutionSopCoverage();
    const byKey = new Map(rows.map((r) => [normalizeInstitutionKey(r.name), r] as const));

    const columbia = byKey.get("columbia")!;
    expect(columbia.accountCount).toBe(2);
    expect(columbia.sopCount).toBe(1);
    expect(columbia.needsSop).toBe(false);

    const firstInterstate = byKey.get("first interstate bank")!;
    expect(firstInterstate.accountCount).toBe(1);
    expect(firstInterstate.sopCount).toBe(0);
    expect(firstInterstate.needsSop).toBe(true);

    // The uncovered bank leads the list; idle banks stay hidden.
    expect(rows[0].name).toBe("First Interstate Bank");
    expect(byKey.has("wells fargo")).toBe(false);
  });

  it("backfill normalizes legacy SOP keys and is idempotent", async () => {
    // Simulate a legacy row written before whitespace folding existed.
    const [legacy] = await db
      .insert(sopTemplates)
      .values({ title: "Legacy Columbia procedure", institutionKey: "  Columbia   Bank " })
      .returning();
    expect(legacy.institutionKey).toBe("  Columbia   Bank ");

    const first = await normalizeSopInstitutionKeys(theoId);
    expect(first.updated).toBe(1);
    const [folded] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, legacy.id)).limit(1);
    expect(folded.institutionKey).toBe("columbia bank");

    // Second run: nothing left to fold (idempotent).
    const second = await normalizeSopInstitutionKeys(theoId);
    expect(second.updated).toBe(0);
  });
});
