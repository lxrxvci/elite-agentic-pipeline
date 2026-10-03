import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { addDays, formatLocalDate, parseLocalDate } from "@firmos/domain";

import { db } from "@/db";
import { clients, tasks, users } from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import { completeTask } from "@/server/work-items";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * K5 (E6, 09_30 00:56:49): "within seven days of the client questions being
 * answered" - completing the period's Client Questions task pulls the same
 * period's open Send Reports task to a 7-day deadline.
 */

const reachable = await dbReachable();

describe.skipIf(!reachable)("questions answered -> 7-day report clock", () => {
  let clientId: number;
  let bookkeeperId: number;
  let managerId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const [client] = await db.select().from(clients).where(eq(clients.legalName, "Harborline Marine Supply")).limit(1);
    clientId = client.id;
    bookkeeperId = (await db.select().from(users).where(eq(users.email, "sofia@blueledgerbooks.com")).limit(1))[0].id;
    managerId = (await db.select().from(users).where(eq(users.email, "dana@blueledgerbooks.com")).limit(1))[0].id;
  });

  it("questions_addressed_starts_7_day_report_clock", async () => {
    const [questions] = await db
      .insert(tasks)
      .values({
        clientId,
        title: "Client Questions",
        status: "open",
        attributedYear: 2026,
        attributedMonth: 8,
        dueDate: "2026-08-25",
      })
      .returning();
    const [reports] = await db
      .insert(tasks)
      .values({
        clientId,
        title: "Send Reports",
        status: "open",
        attributedYear: 2026,
        attributedMonth: 8,
        dueDate: "2026-09-10", // the tier-day default - about to be overridden
      })
      .returning();

    await completeTask(questions.id, true, managerId);

    const [after] = await db.select().from(tasks).where(eq(tasks.id, reports.id));
    // The due date is completion day + 7 (firm-local).
    expect(after.dueDate).not.toBe("2026-09-10");
    const [questionsAfter] = await db.select().from(tasks).where(eq(tasks.id, questions.id));
    const completedDay = questionsAfter.completedAt!.toISOString().slice(0, 10);
    expect(after.dueDate).toBe(formatLocalDate(addDays(parseLocalDate(completedDay), 7)));

    // An unrelated period's Send Reports is untouched; and re-opening the
    // questions task never rewrites the deadline.
    await completeTask(questions.id, false, managerId);
    const [afterReopen] = await db.select().from(tasks).where(eq(tasks.id, reports.id));
    expect(afterReopen.dueDate).toBe(after.dueDate);
  });

  it("the seeded recurring pair behaves the same: the reports task reprices its due date", async () => {
    // July's seeded Send Reports row moves too when July's questions close.
    const [reports] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.clientId, clientId),
          eq(tasks.title, "Send Reports"),
          eq(tasks.attributedYear, 2026),
          eq(tasks.attributedMonth, 7),
        ),
      )
      .limit(1);
    const [questions] = await db
      .insert(tasks)
      .values({
        clientId,
        title: "Client Questions",
        status: "open",
        attributedYear: 2026,
        attributedMonth: 7,
        dueDate: "2026-07-25",
      })
      .returning();
    await completeTask(questions.id, true, bookkeeperId);
    const [qAfter] = await db.select().from(tasks).where(eq(tasks.id, questions.id));
    expect(qAfter.completedAt).not.toBeNull();
    if (reports) {
      const [rAfter] = await db.select().from(tasks).where(eq(tasks.id, reports.id));
      const completedDay = qAfter.completedAt!.toISOString().slice(0, 10);
      expect(rAfter.dueDate).toBe(formatLocalDate(addDays(parseLocalDate(completedDay), 7)));
    }
  });
});
