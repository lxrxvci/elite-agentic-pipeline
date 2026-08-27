import { beforeAll, describe, expect, it } from "vitest";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { accounts, clients, documents, weeklyBankFeeds } from "@/db/schema";
import { getUnifiedQueue, type WorkCard, type WorkOrderClass } from "@/server/queue";
import { seedDatabase } from "@/server/seed";
import { getCurrentUserId } from "@/server/session";

import { TEST_TODAY, clientIdByName, dbReachable } from "./helpers";

const reachable = await dbReachable();

function allCards(q: Awaited<ReturnType<typeof getUnifiedQueue>>): WorkCard[] {
  return Object.values(q.buckets).flat();
}

describe.skipIf(!reachable)("getUnifiedQueue - buckets and prior-period gating", () => {
  let queue: Awaited<ReturnType<typeof getUnifiedQueue>>;
  let pausedId: number;
  let projectId: number;
  let blueSpruceId: number;
  let copperlineId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const allClients = await db.select().from(clients);
    pausedId = clientIdByName(allClients, "Redwood Pediatric Therapy");
    projectId = clientIdByName(allClients, "Summit Peak Builders");
    blueSpruceId = clientIdByName(allClients, "Blue Spruce Landscaping");
    copperlineId = clientIdByName(allClients, "Copperline Coffee Roasters");
    queue = await getUnifiedQueue(await getCurrentUserId(), TEST_TODAY);
  });

  it("returns one card shape across all four work kinds", () => {
    const cards = allCards(queue);
    expect(cards.length).toBeGreaterThan(0);
    const kinds = new Set(cards.map((c) => c.kind));
    expect(kinds).toEqual(new Set(["task", "bank_feed", "reconciliation", "report"]));
    for (const c of cards) {
      expect(c).toMatchObject({
        kind: expect.any(String),
        id: expect.any(Number),
        clientId: expect.any(Number),
        clientName: expect.any(String),
        title: expect.any(String),
        status: expect.any(String),
        waitingOnClient: expect.any(Boolean),
      });
    }
  });

  it("contributes nothing for on-hold or project clients", () => {
    const cards = allCards(queue);
    expect(cards.some((c) => c.clientId === pausedId)).toBe(false);
    // Project engagement: no periodic rows and no rules were generated.
    expect(cards.some((c) => c.clientId === projectId)).toBe(false);
  });

  it("keeps the waiting-on-client feed in its own bucket, never overdue", () => {
    const waiting = queue.buckets.waiting_on_client.filter(
      (c) => c.clientId === blueSpruceId && c.kind === "bank_feed",
    );
    expect(waiting).toHaveLength(1);
    expect(waiting[0].waitingOnClient).toBe(true);
    expect(queue.buckets.overdue.some((c) => c.id === waiting[0].id && c.kind === "bank_feed")).toBe(false);
  });

  it("keeps the deferred feed in the deferred bucket until its date", () => {
    const deferred = queue.buckets.deferred.filter(
      (c) => c.clientId === blueSpruceId && c.kind === "bank_feed",
    );
    expect(deferred).toHaveLength(1);
    expect(deferred[0].deferredUntil).toBe("2026-08-29");
    expect(queue.buckets.overdue.some((c) => c.id === deferred[0].id && c.kind === "bank_feed")).toBe(false);
  });

  it("applies prior-period gating to ALL date buckets, not just overdue (§29 fix)", () => {
    // Copperline is quarterly with no completed work: its earliest period is
    // open, so every LATER period of the same kind/rule must be gated out of
    // overdue/due_today/upcoming regardless of its due date.
    const dateBuckets = [
      ...queue.buckets.overdue,
      ...queue.buckets.due_today,
      ...queue.buckets.upcoming,
    ];
    const gated = queue.buckets.gated.filter((c) => c.clientId === copperlineId);
    expect(gated.length).toBeGreaterThan(0);

    const earliestOpen = (kind: WorkCard["kind"]) => {
      const periods = [...gated, ...dateBuckets]
        .filter((c) => c.clientId === copperlineId && c.kind === kind)
        .map((c) => ({ y: c.attributedYear!, m: c.attributedMonth! }));
      if (periods.length === 0) return null;
      return periods.reduce((min, p) => (p.y * 12 + p.m < min.y * 12 + min.m ? p : min));
    };

    for (const kind of ["reconciliation", "report"] as const) {
      const first = earliestOpen(kind);
      if (!first) continue;
      const laterInDateBuckets = dateBuckets.filter(
        (c) =>
          c.clientId === copperlineId &&
          c.kind === kind &&
          (c.attributedYear! * 12 + c.attributedMonth! > first.y * 12 + first.m),
      );
      expect(laterInDateBuckets).toEqual([]);
    }

    // The earliest open period itself is NOT gated and shows up in a date bucket.
    const ungated = dateBuckets.filter((c) => c.clientId === copperlineId);
    expect(ungated.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!reachable)("getUnifiedQueue - work-day filter", () => {
  let userId: number;
  let harborlineId: number;
  let northwindId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const allClients = await db.select().from(clients);
    harborlineId = clientIdByName(allClients, "Harborline Marine Supply");
    northwindId = clientIdByName(allClients, "Northwind Frame & Door");
    userId = await getCurrentUserId();
  });

  it("stamps every card with the client's work day and order class", async () => {
    const queue = await getUnifiedQueue(userId, TEST_TODAY);
    const cards = allCards(queue);
    expect(cards.length).toBeGreaterThan(0);
    const harborline = cards.filter((c) => c.clientId === harborlineId);
    expect(harborline.length).toBeGreaterThan(0);
    for (const c of harborline) expect(c.clientWorkDay).toBe(1); // Monday (seed)
    const northwind = cards.filter((c) => c.clientId === northwindId);
    expect(northwind.length).toBeGreaterThan(0);
    for (const c of northwind) expect(c.clientWorkDay).toBeNull(); // unassigned (seed)
  });

  it("no filter includes assigned-day AND unassigned-day clients", async () => {
    const cards = allCards(await getUnifiedQueue(userId, TEST_TODAY));
    expect(cards.some((c) => c.clientWorkDay === 1)).toBe(true);
    expect(cards.some((c) => c.clientWorkDay == null)).toBe(true);
  });

  it("a picked day keeps only that day's clients (unassigned excluded)", async () => {
    const cards = allCards(await getUnifiedQueue(userId, TEST_TODAY, { workDay: 1 }));
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.clientWorkDay).toBe(1);
    expect(cards.some((c) => c.clientId === northwindId)).toBe(false);
  });

  it("a day with no assigned clients returns an empty queue", async () => {
    const cards = allCards(await getUnifiedQueue(userId, TEST_TODAY, { workDay: 3 }));
    expect(cards).toEqual([]);
  });

  it("'any' selects only unassigned-day clients", async () => {
    const cards = allCards(await getUnifiedQueue(userId, TEST_TODAY, { workDay: "any" }));
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.clientWorkDay).toBeNull();
    expect(cards.some((c) => c.clientId === northwindId)).toBe(true);
  });
});

describe.skipIf(!reachable)("getUnifiedQueue - within-bucket daily ordering", () => {
  const RANK: Record<WorkOrderClass, number> = {
    periodic: 0,
    ad_hoc: 1,
    reconciliation: 2,
    report: 3,
  };

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("sorts every bucket by order class, then due date, then client name", async () => {
    const queue = await getUnifiedQueue(await getCurrentUserId(), TEST_TODAY);
    for (const bucket of Object.values(queue.buckets)) {
      for (let i = 1; i < bucket.length; i++) {
        const a = bucket[i - 1];
        const b = bucket[i];
        const rankA = RANK[a.orderClass ?? "periodic"];
        const rankB = RANK[b.orderClass ?? "periodic"];
        expect(rankA).toBeLessThanOrEqual(rankB);
        if (rankA !== rankB) continue;
        if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
          expect(a.dueDate < b.dueDate).toBe(true);
        } else if (a.dueDate !== b.dueDate) {
          expect(a.dueDate != null).toBe(true); // dated before undated
        } else {
          expect(a.clientName.localeCompare(b.clientName)).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("classifies kinds: feeds + recurring tasks periodic, one-off tasks ad_hoc", async () => {
    const queue = await getUnifiedQueue(await getCurrentUserId(), TEST_TODAY);
    const cards = allCards(queue);
    for (const c of cards) {
      if (c.kind === "bank_feed") expect(c.orderClass).toBe("periodic");
      if (c.kind === "reconciliation") expect(c.orderClass).toBe("reconciliation");
      if (c.kind === "report") expect(c.orderClass).toBe("report");
    }
    // The seeded recurring-rule tasks are periodic.
    expect(cards.some((c) => c.kind === "task" && c.orderClass === "periodic")).toBe(true);
  });
});

describe.skipIf(!reachable)("getUnifiedQueue - reconciliation readiness", () => {
  let userId: number;
  let harborlineId: number;
  let blueSpruceId: number;
  let operatingId: number; // Harborline Operating Checking (statement uploaded, feeds settled)
  let creditCardId: number; // Harborline Business Credit Card (no statement)
  let spruceMainId: number; // Blue Spruce Main Checking (statement uploaded, feeds open)

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    userId = await getCurrentUserId();
    const allClients = await db.select().from(clients);
    harborlineId = clientIdByName(allClients, "Harborline Marine Supply");
    blueSpruceId = clientIdByName(allClients, "Blue Spruce Landscaping");
    const accountRows = await db.select().from(accounts);
    operatingId = accountRows.find((a) => a.clientId === harborlineId && a.name === "Operating Checking")!.id;
    creditCardId = accountRows.find((a) => a.clientId === harborlineId && a.name === "Business Credit Card")!.id;
    spruceMainId = accountRows.find((a) => a.clientId === blueSpruceId && a.name === "Main Checking")!.id;

    // June 2026 statements: Operating Checking (Harborline) and Main Checking
    // (Blue Spruce) - statement documents derive readiness (§6.7).
    await db.insert(documents).values([
      {
        clientId: harborlineId,
        accountId: operatingId,
        fileName: "operating-june.pdf",
        storedPath: "test/harborline-operating-202606.pdf",
        docType: "statement",
        statementDate: "2026-07-31",
        attributedYear: 2026,
        attributedMonth: 6,
      },
      {
        clientId: blueSpruceId,
        accountId: spruceMainId,
        fileName: "main-june.pdf",
        storedPath: "test/bluespruce-main-202606.pdf",
        docType: "statement",
        statementDate: "2026-07-31",
        attributedYear: 2026,
        attributedMonth: 6,
      },
    ]);

    // Harborline's June feeds are all settled (completed); Blue Spruce's
    // June feeds stay open.
    await db
      .update(weeklyBankFeeds)
      .set({ completedAt: new Date(), completedById: userId })
      .where(
        and(
          eq(weeklyBankFeeds.clientId, harborlineId),
          eq(weeklyBankFeeds.attributedYear, 2026),
          eq(weeklyBankFeeds.attributedMonth, 6),
        ),
      );
  });

  function reconCard(
    cards: WorkCard[],
    accountName: string,
    month: number,
  ): WorkCard {
    const card = cards.find(
      (c) =>
        c.kind === "reconciliation" &&
        c.title === `Reconcile ${accountName}` &&
        c.attributedYear === 2026 &&
        c.attributedMonth === month,
    );
    if (!card) throw new Error(`recon card not found: ${accountName} ${month}`);
    return card;
  }

  it("statement uploaded + feeds settled → ready to reconcile", async () => {
    const cards = allCards(await getUnifiedQueue(userId, TEST_TODAY));
    const card = reconCard(cards, "Operating Checking", 6);
    expect(card.statementAvailable).toBe(true);
    expect(card.readyToReconcile).toBe(true);
  });

  it("missing statement → not ready (statementAvailable false)", async () => {
    const cards = allCards(await getUnifiedQueue(userId, TEST_TODAY));
    const card = reconCard(cards, "Business Credit Card", 6);
    expect(card.statementAvailable).toBe(false);
    expect(card.readyToReconcile).toBe(false);
  });

  it("statement uploaded but feeds open → not ready (feeds gate)", async () => {
    const cards = allCards(await getUnifiedQueue(userId, TEST_TODAY));
    const card = reconCard(cards, "Main Checking", 6);
    expect(card.statementAvailable).toBe(true);
    expect(card.readyToReconcile).toBe(false);
  });

  it("readiness fields stay off non-reconciliation cards", async () => {
    const cards = allCards(await getUnifiedQueue(userId, TEST_TODAY));
    for (const c of cards) {
      if (c.kind !== "reconciliation") {
        expect(c.readyToReconcile).toBeUndefined();
        expect(c.statementAvailable).toBeUndefined();
      }
    }
  });
});
