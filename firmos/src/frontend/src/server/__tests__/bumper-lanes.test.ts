import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  bumperLaneOverrideRequests,
  clientReports,
  clients,
  notifications,
  recurringTasks,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";
import {
  BumperLaneError,
  BumperLaneLockedError,
  listPendingBumperOverrides,
  requestBumperLaneOverride,
  reviewBumperLaneOverride,
  revokeBumperLaneOverride,
} from "@/server/bumper-lanes";
import { getUnifiedQueue, type WorkCard } from "@/server/queue";
import { seedDatabase } from "@/server/seed";
import {
  completeTask,
  setBankFeedCompleted,
  setReconciliationCompleted,
  setReportCompleted,
} from "@/server/work-items";

import { TEST_TODAY, dbReachable } from "./helpers";

/**
 * Bumper lanes (walkthrough D6/D7/D8/L3) - server pins over the real queue:
 * one client at a time, kind order bank feeds -> ad-hoc tasks ->
 * reconciliations -> recurring -> reports, lock enforcement on every
 * completion path, and the time-boxed override lifecycle (request ->
 * four-eyes review -> 24h grant -> revoke/expiry).
 */

const reachable = await dbReachable();

function allCards(q: Awaited<ReturnType<typeof getUnifiedQueue>>): WorkCard[] {
  return Object.values(q.buckets).flat();
}

describe.skipIf(!reachable)("bumper lanes (D6/D7/D8/L3)", () => {
  let bookkeeperId: number; // fresh fixture user - only fixture work assigned
  let managerId: number; // seeded manager (Dana) - reviewer
  let adminId: number; // seeded admin (Theo) - reviewer
  let ownerId: number; // seeded owner (Mara) - reviewer
  let laneManagerId: number; // fixture manager with lanes on (four-eyes case)

  let alphaId: number;
  let betaId: number;
  let alphaFeedId: number;
  let betaFeedId: number;
  let alphaAdhocId: number;
  let alphaRecurringId: number;
  let alphaReconId: number;
  let alphaReportId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const byEmail = async (email: string) =>
      (await db.select().from(users).where(eq(users.email, email)).limit(1))[0].id;
    managerId = await byEmail("dana@blueledgerbooks.com");
    adminId = await byEmail("theo@blueledgerbooks.com");
    ownerId = await byEmail("mara@blueledgerbooks.com");

    const [bk] = await db
      .insert(users)
      .values({
        email: "lane-tester@firmos-test.local",
        firstName: "Lane",
        lastName: "Tester",
        passwordHash: "x",
        role: "bookkeeper",
        bumperLanesEnabled: true,
      })
      .returning();
    bookkeeperId = bk.id;
    const [lm] = await db
      .insert(users)
      .values({
        email: "lane-manager@firmos-test.local",
        firstName: "Lane",
        lastName: "Manager",
        passwordHash: "x",
        role: "manager",
        bumperLanesEnabled: true,
      })
      .returning();
    laneManagerId = lm.id;

    // Fixture clients: all of the tester's work, in known due order.
    const [alpha] = await db
      .insert(clients)
      .values({
        legalName: "Lane Alpha Co",
        bookkeepingFrequency: "monthly",
        monthlyCloseTier: "15",
        managerId: bookkeeperId, // report cards route to the manager slot
        bookkeeperId,
      })
      .returning();
    alphaId = alpha.id;
    const [beta] = await db
      .insert(clients)
      .values({
        legalName: "Lane Beta Co",
        bookkeepingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeeperId,
      })
      .returning();
    betaId = beta.id;

    const [alphaFeed] = await db
      .insert(weeklyBankFeeds)
      .values({
        clientId: alphaId,
        weekStartDate: "2026-08-10",
        weekEndDate: "2026-08-16",
        dueDate: "2026-08-10", // overdue at TEST_TODAY - earliest work overall
        attributedYear: 2026,
        attributedMonth: 8,
      })
      .returning();
    alphaFeedId = alphaFeed.id;
    const [betaFeed] = await db
      .insert(weeklyBankFeeds)
      .values({
        clientId: betaId,
        weekStartDate: "2026-08-10",
        weekEndDate: "2026-08-16",
        dueDate: "2026-08-15", // due_today
        attributedYear: 2026,
        attributedMonth: 8,
      })
      .returning();
    betaFeedId = betaFeed.id;

    const [adhoc] = await db
      .insert(tasks)
      .values({
        clientId: alphaId,
        title: "Alpha ad-hoc cleanup",
        taskType: "ad_hoc",
        status: "open",
        dueDate: "2026-08-15",
        assigneeId: bookkeeperId,
      })
      .returning();
    alphaAdhocId = adhoc.id;

    const [rule] = await db
      .insert(recurringTasks)
      .values({
        clientId: alphaId,
        title: "Alpha monthly close",
        scheduleType: "monthly",
        dayOfMonth: 15,
        assigneeId: bookkeeperId,
      })
      .returning();
    const [recurringInstance] = await db
      .insert(tasks)
      .values({
        clientId: alphaId,
        recurringTaskId: rule.id,
        title: "Alpha monthly close",
        taskType: "recurring",
        status: "new",
        dueDate: "2026-08-15",
        attributedYear: 2026,
        attributedMonth: 8,
        assigneeId: bookkeeperId,
      })
      .returning();
    alphaRecurringId = recurringInstance.id;

    const [account] = await db
      .insert(accounts)
      .values({ clientId: alphaId, name: "Operating", accountType: "checking", statementDay: 31 })
      .returning();
    const [recon] = await db
      .insert(accountReconciliations)
      .values({
        accountId: account.id,
        clientId: alphaId,
        attributedYear: 2026,
        attributedMonth: 8,
        statementDate: "2026-08-31",
        dueDate: "2026-08-20", // upcoming
      })
      .returning();
    alphaReconId = recon.id;

    const [report] = await db
      .insert(clientReports)
      .values({
        clientId: alphaId,
        name: "Monthly review",
        attributedYear: 2026,
        attributedMonth: 8,
        dueDate: "2026-08-20",
      })
      .returning();
    alphaReportId = report.id;
  });

  const queueFor = () => getUnifiedQueue(bookkeeperId, TEST_TODAY);
  const cardBy = (q: Awaited<ReturnType<typeof queueFor>>, kind: WorkCard["kind"], id: number) =>
    allCards(q).find((c) => c.kind === kind && c.id === id)!;

  it("serves one client at a time and locks later-kind and other-client cards", async () => {
    const queue = await queueFor();
    expect(queue.bumperLanes.enabled).toBe(true);
    expect(queue.bumperLanes.activeClientId).toBe(alphaId);
    expect(queue.bumperLanes.activeStage).toBe("bank_feeds");

    // The in-lane card is unlocked...
    expect(cardBy(queue, "bank_feed", alphaFeedId).laneLocked ?? false).toBe(false);

    // ...every later stage of Alpha's and every other-client card is locked,
    // with the human reason, never hidden.
    const locked: [WorkCard["kind"], number][] = [
      ["task", alphaAdhocId],
      ["task", alphaRecurringId],
      ["reconciliation", alphaReconId],
      ["report", alphaReportId],
      ["bank_feed", betaFeedId],
    ];
    for (const [kind, id] of locked) {
      const card = cardBy(queue, kind, id);
      expect(card, `${kind}:${id}`).toBeDefined();
      expect(card.laneLocked).toBe(true);
      expect(card.laneLockReason).toBe("Finish Lane Alpha Co's bank feeds first");
    }
  });

  it("does not lane-govern users whose lanes are off", async () => {
    const maraQueue = await getUnifiedQueue(ownerId, TEST_TODAY);
    expect(maraQueue.bumperLanes.enabled).toBe(false);
    expect(allCards(maraQueue).every((c) => c.laneLocked !== true)).toBe(true);
  });

  it("blocks completing locked cards on every kind path, with the reason", async () => {
    await expect(completeTask(alphaAdhocId, true, bookkeeperId)).rejects.toThrow(
      BumperLaneLockedError,
    );
    await expect(completeTask(alphaAdhocId, true, bookkeeperId)).rejects.toThrow(
      "Finish Lane Alpha Co's bank feeds first",
    );
    await expect(setReconciliationCompleted(alphaReconId, true, bookkeeperId)).rejects.toThrow(
      BumperLaneLockedError,
    );
    await expect(setReportCompleted(alphaReportId, true, bookkeeperId)).rejects.toThrow(
      BumperLaneLockedError,
    );
    // The other client's card is locked too.
    await expect(setBankFeedCompleted(betaFeedId, true, bookkeeperId)).rejects.toThrow(
      BumperLaneLockedError,
    );
    // Nothing was completed.
    const [still] = await db.select().from(tasks).where(eq(tasks.id, alphaAdhocId));
    expect(still.status).toBe("open");
  });

  it("the in-lane card completes and the lane advances to tasks", async () => {
    await setBankFeedCompleted(alphaFeedId, true, bookkeeperId);
    const queue = await queueFor();
    expect(queue.bumperLanes.activeStage).toBe("tasks");
    expect(cardBy(queue, "task", alphaAdhocId).laneLocked ?? false).toBe(false);
    expect(cardBy(queue, "reconciliation", alphaReconId).laneLocked).toBe(true);
    expect(cardBy(queue, "reconciliation", alphaReconId).laneLockReason).toBe(
      "Finish Lane Alpha Co's tasks first",
    );
  });

  it("runs the override lifecycle: request -> purgatory -> four-eyes -> 24h grant", async () => {
    // The recon is lane-locked right now (stage = tasks, recon is later).
    const request = await requestBumperLaneOverride(
      bookkeeperId,
      { kind: "reconciliation", id: alphaReconId },
      "Client's lender needs the reconciled statement today",
    );
    expect(request.status).toBe("pending");

    // One pending request per card.
    await expect(
      requestBumperLaneOverride(bookkeeperId, { kind: "reconciliation", id: alphaReconId }, "again"),
    ).rejects.toThrow(BumperLaneError);

    // It lands in the purgatory read for approvers...
    const pending = await listPendingBumperOverrides();
    const item = pending.find((p) => p.id === request.id);
    expect(item).toBeDefined();
    expect(item!.clientName).toBe("Lane Alpha Co");
    expect(item!.requesterName).toBe("Lane Tester");
    expect(item!.reason).toContain("lender");

    // ...and manager/admin/owner all get the notification.
    const notices = await db
      .select()
      .from(notifications)
      .where(eq(notifications.notificationType, "bumper_override_requested"));
    const notified = new Set(notices.map((n) => n.userId));
    expect(notified.has(managerId)).toBe(true);
    expect(notified.has(adminId)).toBe(true);
    expect(notified.has(ownerId)).toBe(true);

    // Four-eyes: the requester can never review (role check fires for a
    // bookkeeper); a laned MANAGER requester hits the different-user rule.
    await expect(
      reviewBumperLaneOverride(request.id, bookkeeperId, true),
    ).rejects.toThrow(BumperLaneError);

    // Approval stamps the 24-hour expiry and notifies the requester.
    const reviewed = await reviewBumperLaneOverride(request.id, managerId, true);
    expect(reviewed.status).toBe("approved");
    expect(reviewed.reviewedById).toBe(managerId);
    const ttlMs = reviewed.expiresAt!.getTime() - reviewed.reviewedAt!.getTime();
    expect(ttlMs).toBe(24 * 60 * 60 * 1000);
    const outcome = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.notificationType, "bumper_override_approved"),
          eq(notifications.userId, bookkeeperId),
        ),
      );
    expect(outcome.length).toBe(1);

    // The queue unlocks exactly that card (marked as an active grant)...
    const queue = await queueFor();
    const recon = cardBy(queue, "reconciliation", alphaReconId);
    expect(recon.laneLocked ?? false).toBe(false);
    expect(recon.laneOverride).toBe("active");
    // ...and the completion gate lets it through.
    await setReconciliationCompleted(alphaReconId, true, bookkeeperId);
  });

  it("rejects requests that make no sense", async () => {
    // Lanes off for this user.
    const [jorge] = await db
      .select()
      .from(users)
      .where(eq(users.email, "jorge@blueledgerbooks.com"))
      .limit(1);
    await expect(
      requestBumperLaneOverride(jorge.id, { kind: "task", id: alphaAdhocId }, "please"),
    ).rejects.toThrow("Bumper lanes are off");

    // The ad-hoc task is in-lane right now - nothing to override.
    await expect(
      requestBumperLaneOverride(bookkeeperId, { kind: "task", id: alphaAdhocId }, "please"),
    ).rejects.toThrow("not locked");

    // Unknown card.
    await expect(
      requestBumperLaneOverride(bookkeeperId, { kind: "task", id: 999_999 }, "please"),
    ).rejects.toThrow(BumperLaneError);

    // The reason is required.
    await expect(
      requestBumperLaneOverride(bookkeeperId, { kind: "task", id: alphaRecurringId }, " "),
    ).rejects.toThrow("reason");
  });

  it("enforces four-eyes for a manager requester (different user must review)", async () => {
    // Give the laned manager a locked card: a task of theirs behind Alpha's
    // current stage... the manager's lane needs its own work. Fixture: one
    // feed (stage bank_feeds) + one task (locked behind it).
    const [client] = await db
      .insert(clients)
      .values({ legalName: "Lane Manager Co", bookkeeperId: laneManagerId })
      .returning();
    await db.insert(weeklyBankFeeds).values({
      clientId: client.id,
      weekStartDate: "2026-08-10",
      weekEndDate: "2026-08-16",
      dueDate: "2026-08-10",
      attributedYear: 2026,
      attributedMonth: 8,
    });
    const [mgrTask] = await db
      .insert(tasks)
      .values({
        clientId: client.id,
        title: "Manager's own task",
        taskType: "ad_hoc",
        status: "open",
        dueDate: "2026-08-12",
        assigneeId: laneManagerId,
      })
      .returning();

    const request = await requestBumperLaneOverride(
      laneManagerId,
      { kind: "task", id: mgrTask.id },
      "Manager needs to jump ahead",
    );
    // A manager may review overrides in general - but never their own.
    await expect(reviewBumperLaneOverride(request.id, laneManagerId, true)).rejects.toThrow(
      "different user",
    );
    const reviewed = await reviewBumperLaneOverride(request.id, ownerId, true);
    expect(reviewed.status).toBe("approved");
  });

  it("the grant expires: an out-of-date approval re-locks the card", async () => {
    const request = await requestBumperLaneOverride(
      bookkeeperId,
      { kind: "task", id: alphaRecurringId },
      "Need the recurring close early",
    );
    // Approved two days ago -> the 24h grant is already dead.
    const reviewed = await reviewBumperLaneOverride(
      request.id,
      adminId,
      true,
      new Date(Date.now() - 48 * 60 * 60 * 1000),
    );
    expect(reviewed.status).toBe("approved");
    expect(reviewed.expiresAt!.getTime()).toBeLessThan(Date.now());

    const queue = await queueFor();
    const card = cardBy(queue, "task", alphaRecurringId);
    expect(card.laneLocked).toBe(true);
    await expect(completeTask(alphaRecurringId, true, bookkeeperId)).rejects.toThrow(
      BumperLaneLockedError,
    );
  });

  it("a manager+ can revoke an active grant; the requester cannot", async () => {
    const request = await requestBumperLaneOverride(
      bookkeeperId,
      { kind: "report", id: alphaReportId },
      "Board deck moved up",
    );
    await reviewBumperLaneOverride(request.id, adminId, true);

    // Active in the queue before revoke.
    let queue = await queueFor();
    expect(cardBy(queue, "report", alphaReportId).laneOverride).toBe("active");

    await expect(revokeBumperLaneOverride(request.id, bookkeeperId)).rejects.toThrow(
      BumperLaneError,
    );
    const revoked = await revokeBumperLaneOverride(request.id, ownerId);
    expect(revoked.status).toBe("cancelled");

    queue = await queueFor();
    expect(cardBy(queue, "report", alphaReportId).laneLocked).toBe(true);
    await expect(setReportCompleted(alphaReportId, true, bookkeeperId)).rejects.toThrow(
      BumperLaneLockedError,
    );

    // A cancelled grant cannot be re-revoked.
    await expect(revokeBumperLaneOverride(request.id, ownerId)).rejects.toThrow(BumperLaneError);
  });

  it("audit trail: every lifecycle step wrote an event", async () => {
    const { auditEvents } = await import("@/db/schema");
    const rows = await db.select().from(auditEvents).where(
      eq(auditEvents.entityType, "bumper_lane_override_request"),
    );
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has("bumper_override_requested")).toBe(true);
    expect(actions.has("bumper_override_approved")).toBe(true);
    expect(actions.has("bumper_override_revoked")).toBe(true);
  });
});
