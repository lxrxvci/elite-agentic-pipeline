import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  accountReconciliations,
  clientReports,
  clients,
  documents,
  tasks,
  weeklyBankFeeds,
} from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import { getCurrentUserId } from "@/server/session";
import {
  ReportDocumentRequiredError,
  completeReportRowsForDocument,
  completeTask,
  setBankFeedCompleted,
} from "@/server/work-items";

import { TEST_TODAY, clientIdByName, dbReachable } from "./helpers";

const reachable = await dbReachable();

const PERIOD = { year: 2026, month: 7 };

describe.skipIf(!reachable)("bidirectional sync (§6.3)", () => {
  let userId: number;
  let harborlineId: number;

  const feedsForPeriod = () =>
    db
      .select()
      .from(weeklyBankFeeds)
      .where(
        and(
          eq(weeklyBankFeeds.clientId, harborlineId),
          eq(weeklyBankFeeds.attributedYear, PERIOD.year),
          eq(weeklyBankFeeds.attributedMonth, PERIOD.month),
        ),
      );

  const taskFor = (title: string) =>
    db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.clientId, harborlineId),
          eq(tasks.attributedYear, PERIOD.year),
          eq(tasks.attributedMonth, PERIOD.month),
          eq(tasks.title, title),
        ),
      )
      .then((rows) => rows[0]);

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    userId = await getCurrentUserId();
    const allClients = await db.select().from(clients);
    harborlineId = clientIdByName(allClients, "Harborline Marine Supply");
  });

  it("completing every feed in a month auto-completes that month's 'Categorize Transactions' task", async () => {
    const feeds = await feedsForPeriod();
    expect(feeds.length).toBeGreaterThanOrEqual(2);
    const taskBefore = await taskFor("Categorize Transactions");
    expect(taskBefore).toBeDefined();
    expect(taskBefore.status).not.toBe("completed");

    for (const feed of feeds) {
      await setBankFeedCompleted(feed.id, true, userId);
    }
    const taskAfter = await taskFor("Categorize Transactions");
    expect(taskAfter.status).toBe("completed");
    expect(taskAfter.completedById).toBe(userId);
    expect(taskAfter.completedAt).not.toBeNull();
  });

  it("re-completing an already-complete feed preserves its original completed_at (bulk syncs don't rewrite history)", async () => {
    const feeds = await feedsForPeriod();
    const originalCompletedAt = feeds[0].completedAt;
    expect(originalCompletedAt).not.toBeNull();

    await setBankFeedCompleted(feeds[0].id, true, userId);
    const [again] = await feedsForPeriod();
    expect(again.completedAt?.getTime()).toBe(originalCompletedAt!.getTime());
  });

  it("re-opening one feed re-opens the summary task", async () => {
    const feeds = await feedsForPeriod();

    await setBankFeedCompleted(feeds[0].id, false, userId);
    expect((await taskFor("Categorize Transactions")).status).not.toBe("completed");

    await setBankFeedCompleted(feeds[0].id, true, userId);
    expect((await taskFor("Categorize Transactions")).status).toBe("completed");
  });

  it("completing the 'Reconcile Accounts' task completes that month's reconciliations and clears parked state", async () => {
    const recons = await db
      .select()
      .from(accountReconciliations)
      .where(
        and(
          eq(accountReconciliations.clientId, harborlineId),
          eq(accountReconciliations.attributedYear, PERIOD.year),
          eq(accountReconciliations.attributedMonth, PERIOD.month),
        ),
      );
    expect(recons).toHaveLength(3);
    // Park one row first - the task completion must clear it (§6.3).
    await db
      .update(accountReconciliations)
      .set({ waitingOnClient: true, clientNote: "need statement" })
      .where(eq(accountReconciliations.id, recons[0].id));

    const task = await taskFor("Reconcile Accounts");
    expect(task).toBeDefined();
    const completed = await completeTask(task.id, true, userId);
    expect(completed.status).toBe("completed");

    const after = await db
      .select()
      .from(accountReconciliations)
      .where(
        and(
          eq(accountReconciliations.clientId, harborlineId),
          eq(accountReconciliations.attributedYear, PERIOD.year),
          eq(accountReconciliations.attributedMonth, PERIOD.month),
        ),
      );
    for (const r of after) {
      expect(r.completedAt).not.toBeNull();
      expect(r.waitingOnClient).toBe(false);
    }

    // Re-opening the task re-opens every row in the month.
    await completeTask(task.id, false, userId);
    const reopened = await db
      .select()
      .from(accountReconciliations)
      .where(
        and(
          eq(accountReconciliations.clientId, harborlineId),
          eq(accountReconciliations.attributedYear, PERIOD.year),
          eq(accountReconciliations.attributedMonth, PERIOD.month),
        ),
      );
    for (const r of reopened) expect(r.completedAt).toBeNull();
  });

  it("blocks report-task completion until a report document exists, then syncs the rows", async () => {
    const task = await taskFor("Send Reports");
    expect(task).toBeDefined();

    await expect(completeTask(task.id, true, userId)).rejects.toBeInstanceOf(
      ReportDocumentRequiredError,
    );
    expect((await taskFor("Send Reports")).status).not.toBe("completed");

    await db.insert(documents).values({
      clientId: harborlineId,
      fileName: "july-financial-package.pdf",
      storedPath: `Harborline Marine Supply/Documents/2026/july-financial-package.pdf`,
      docType: "report",
      attributedYear: PERIOD.year,
      attributedMonth: PERIOD.month,
      uploadedById: userId,
    });

    const completed = await completeTask(task.id, true, userId);
    expect(completed.status).toBe("completed");

    const reports = await db
      .select()
      .from(clientReports)
      .where(
        and(
          eq(clientReports.clientId, harborlineId),
          eq(clientReports.attributedYear, PERIOD.year),
          eq(clientReports.attributedMonth, PERIOD.month),
        ),
      );
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) expect(r.completedAt).not.toBeNull();
  });

  // The drawer's report flow (owner walkthrough 01:39:05): the upload wiring
  // completes the period's open report rows, links the file, and closes the
  // summary task through the existing row → task sync. Uses June so the
  // July-scoped tests above stay untouched.
  it("uploading the report document completes the period's rows and the 'Send Reports' task", async () => {
    const JUNE = { year: 2026, month: 6 };
    const juneTask = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.clientId, harborlineId),
          eq(tasks.attributedYear, JUNE.year),
          eq(tasks.attributedMonth, JUNE.month),
          eq(tasks.title, "Send Reports"),
        ),
      )
      .then((rows) => rows[0]);
    expect(juneTask).toBeDefined();
    expect(juneTask.status).not.toBe("completed");

    const juneReports = await db
      .select()
      .from(clientReports)
      .where(
        and(
          eq(clientReports.clientId, harborlineId),
          eq(clientReports.attributedYear, JUNE.year),
          eq(clientReports.attributedMonth, JUNE.month),
        ),
      );
    expect(juneReports.length).toBeGreaterThan(0);
    for (const r of juneReports) expect(r.completedAt).toBeNull();

    // The report flow: the document row exists first (uploadReportDocument),
    // then the wiring completes the rows it covers.
    const [doc] = await db
      .insert(documents)
      .values({
        clientId: harborlineId,
        fileName: "june-financial-package.pdf",
        storedPath: `harborline-marine-supply/Documents/Reports/${JUNE.year}/june-package.pdf`,
        docType: "report",
        attributedYear: JUNE.year,
        attributedMonth: JUNE.month,
        uploadedById: userId,
      })
      .returning();

    const result = await completeReportRowsForDocument(harborlineId, JUNE, doc.id, userId);

    const openIds = juneReports.map((r) => r.id).sort();
    expect([...result.completedRowIds].sort()).toEqual(openIds);
    expect(result.summaryTaskCompleted).toBe(true);

    const after = await db
      .select()
      .from(clientReports)
      .where(
        and(
          eq(clientReports.clientId, harborlineId),
          eq(clientReports.attributedYear, JUNE.year),
          eq(clientReports.attributedMonth, JUNE.month),
        ),
      );
    for (const r of after) {
      expect(r.completedAt).not.toBeNull();
      expect(r.completedById).toBe(userId);
      expect(r.documentId).toBe(doc.id);
    }

    const taskAfter = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, juneTask.id))
      .then((rows) => rows[0]);
    expect(taskAfter.status).toBe("completed");
    expect(taskAfter.completedById).toBe(userId);

    // Idempotent re-upload path: rows already complete -> nothing moves, no
    // double completion of the task.
    const again = await completeReportRowsForDocument(harborlineId, JUNE, doc.id, userId);
    expect(again.completedRowIds).toEqual([]);
    expect(again.summaryTaskCompleted).toBe(false);
  });

  // Zero-row periods are real (the recurring "Send Reports" rule outruns the
  // client's report definitions): the seed's own 2025-12 instance has a
  // summary task but no report rows. The row → task sync requires rows, so
  // the upload wiring closes the row-less summary task through completeTask.
  it("uploading closes a 'Send Reports' task whose period has no report rows", async () => {
    const STALE = { year: 2025, month: 12 };
    const task = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.clientId, harborlineId),
          eq(tasks.title, "Send Reports"),
          eq(tasks.attributedYear, STALE.year),
          eq(tasks.attributedMonth, STALE.month),
        ),
      )
      .then((rows) => rows[0]);
    expect(task).toBeDefined();
    expect(task.status).not.toBe("completed");

    const rows = await db
      .select()
      .from(clientReports)
      .where(
        and(
          eq(clientReports.clientId, harborlineId),
          eq(clientReports.attributedYear, STALE.year),
          eq(clientReports.attributedMonth, STALE.month),
        ),
      );
    expect(rows).toHaveLength(0);

    const [doc] = await db
      .insert(documents)
      .values({
        clientId: harborlineId,
        fileName: "december-package.pdf",
        storedPath: `harborline-marine-supply/Documents/Reports/${STALE.year}/zero-row-pin.pdf`,
        docType: "report",
        attributedYear: STALE.year,
        attributedMonth: STALE.month,
        uploadedById: userId,
      })
      .returning();

    const result = await completeReportRowsForDocument(harborlineId, STALE, doc.id, userId);
    expect(result.completedRowIds).toEqual([]);
    expect(result.summaryTaskCompleted).toBe(true);

    const after = await db.select().from(tasks).where(eq(tasks.id, task.id)).then((r) => r[0]);
    expect(after.status).toBe("completed");
    expect(after.completedById).toBe(userId);
  });
});
