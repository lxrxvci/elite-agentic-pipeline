import { asc, eq } from "drizzle-orm";
import { mergedMinutes, workPeriodForDue, type Interval } from "@firmos/domain";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { clients, quickNotes, tasks, taskSubtasks, taskTimeEntries, users } from "@/db/schema";
import {
  addQuickNote,
  deleteQuickNote,
  listQuickAddOptions,
  listQuickNotes,
  logMeeting,
  quickAddTask,
  QuickAddError,
} from "@/server/quick-add";
import { seedDatabase } from "@/server/seed";
import { createAdHocTemplate } from "@/server/templates";
import { collectUserIntervals } from "@/server/time-tracking";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

const OWNER = "mara@blueledgerbooks.com";
const MANAGER = "dana@blueledgerbooks.com";

let maraId: number;
let danaId: number;
let harborlineId: number;
let northwindId: number;

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return row.id;
}

async function clientIdByName(legalName: string): Promise<number> {
  const [row] = await db.select({ id: clients.id }).from(clients).where(eq(clients.legalName, legalName)).limit(1);
  if (!row) throw new Error(`seeded client not found: ${legalName}`);
  return row.id;
}

describe.skipIf(!reachable)("quick-add engine (the \"Y button\")", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    maraId = await userIdByEmail(OWNER);
    danaId = await userIdByEmail(MANAGER);
    harborlineId = await clientIdByName("Harborline Marine Supply");
    northwindId = await clientIdByName("Northwind Frame & Door");
  });

  // ── Quick notes ─────────────────────────────────────────────────────────

  it("addQuickNote stores a client-scoped note and a firm-wide sticky", async () => {
    const clientNote = await addQuickNote({ clientId: harborlineId, body: "Ask Alison about the Amex feed." }, maraId);
    expect(clientNote.clientId).toBe(harborlineId);
    expect(clientNote.userId).toBe(maraId);
    expect(clientNote.body).toBe("Ask Alison about the Amex feed.");

    const firmWide = await addQuickNote({ body: "  Friday: payroll day, keep afternoons clear. " }, maraId);
    expect(firmWide.clientId).toBeNull();
    expect(firmWide.body).toBe("Friday: payroll day, keep afternoons clear."); // trimmed
  });

  it("listQuickNotes returns own notes plus firm-wide stickies, newest first, with names", async () => {
    // Another user's client-scoped note must NOT appear for Mara...
    await addQuickNote({ clientId: northwindId, body: "Dana-only context." }, danaId);
    // ...but another user's firm-wide sticky must.
    await addQuickNote({ body: "Dana firm-wide sticky." }, danaId);
    const newest = await addQuickNote({ clientId: harborlineId, body: "Mara newest." }, maraId);

    const feed = await listQuickNotes(maraId);
    expect(feed[0].id).toBe(newest.id);

    const bodies = feed.map((n) => n.body);
    expect(bodies).toContain("Ask Alison about the Amex feed.");
    expect(bodies).toContain("Dana firm-wide sticky.");
    expect(bodies).not.toContain("Dana-only context.");

    const harborlineNote = feed.find((n) => n.body === "Mara newest.");
    expect(harborlineNote?.clientName).toBeTruthy();
    const sticky = feed.find((n) => n.body === "Dana firm-wide sticky.");
    expect(sticky?.clientName).toBeNull();
    expect(sticky?.authorName).toBe("Dana Whitfield");
  });

  it("deleteQuickNote removes only the author's own notes", async () => {
    const note = await addQuickNote({ body: "Mine to delete." }, maraId);
    await expect(deleteQuickNote(note.id, danaId)).rejects.toBeInstanceOf(QuickAddError);
    await expect(deleteQuickNote(note.id, danaId)).rejects.toMatchObject({ status: 404 });
    await deleteQuickNote(note.id, maraId);
    const [row] = await db.select().from(quickNotes).where(eq(quickNotes.id, note.id)).limit(1);
    expect(row).toBeUndefined();
  });

  // ── Quick task ──────────────────────────────────────────────────────────

  it("quickAddTask creates a new ad-hoc task with assignee, due date, and ordered subtasks", async () => {
    const dueDate = "2026-08-20";
    const task = await quickAddTask(
      {
        clientId: harborlineId,
        title: "Chase July bank statement",
        assigneeId: danaId,
        dueDate,
        subtasks: ["Email Alison", "  ", "Download the PDF"],
        billableStatus: "billable",
      },
      maraId,
      TEST_TODAY,
    );

    expect(task.taskType).toBe("ad_hoc");
    expect(task.status).toBe("new"); // lands in the default work lists
    expect(task.clientId).toBe(harborlineId);
    expect(task.assigneeId).toBe(danaId);
    expect(task.dueDate).toBe(dueDate); // stored as picked, no weekend flooring
    expect(task.billableStatus).toBe("billable");
    expect(task.createdById).toBe(maraId);

    const period = workPeriodForDue({ year: 2026, month: 8, day: 20 });
    expect(task.attributedYear).toBe(period.year);
    expect(task.attributedMonth).toBe(period.month);

    const subs = await db
      .select()
      .from(taskSubtasks)
      .where(eq(taskSubtasks.taskId, task.id))
      .orderBy(asc(taskSubtasks.position));
    // Blank lines are dropped, order is preserved.
    expect(subs.map((s) => s.title)).toEqual(["Email Alison", "Download the PDF"]);
  });

  it("quickAddTask rejects empty titles, bad dates, and unknown ids", async () => {
    await expect(
      quickAddTask({ clientId: harborlineId, title: "  " }, maraId, TEST_TODAY),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      quickAddTask({ clientId: harborlineId, title: "X", dueDate: "08/20/2026" }, maraId, TEST_TODAY),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      quickAddTask({ clientId: 999999, title: "X" }, maraId, TEST_TODAY),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      quickAddTask({ clientId: harborlineId, title: "X", assigneeId: 999999 }, maraId, TEST_TODAY),
    ).rejects.toMatchObject({ status: 404 });
  });

  // ── Log meeting ─────────────────────────────────────────────────────────

  it("logMeeting writes a completed billable task plus a time interval the hours union counts", async () => {
    const now = new Date();
    const { task, timeEntry } = await logMeeting(
      { clientId: harborlineId, title: "Quarterly review", durationMinutes: 45, billable: true },
      maraId,
      TEST_TODAY,
      now,
    );

    expect(task.title).toBe("Meeting: Quarterly review");
    expect(task.taskType).toBe("ad_hoc");
    expect(task.status).toBe("completed");
    expect(task.billableStatus).toBe("billable");
    expect(task.completedById).toBe(maraId);
    expect(task.completedAt?.getTime()).toBe(now.getTime());

    expect(timeEntry.taskId).toBe(task.id);
    expect(timeEntry.userId).toBe(maraId);
    expect(timeEntry.durationMinutes).toBe(45);
    expect(timeEntry.endedAt?.getTime()).toBe(now.getTime());
    expect(now.getTime() - timeEntry.startedAt.getTime()).toBe(45 * 60_000);

    // The wall-clock union (collectUserIntervals → taskTimers, the same feed
    // payroll and the hours report use) picks the meeting up: in a window
    // around now it contributes exactly its 45 minutes.
    const collected = await collectUserIntervals(
      maraId,
      new Date(now.getTime() - 60 * 60_000),
      new Date(now.getTime() + 60_000),
    );
    const intervals: Interval[] = collected.taskTimers.map((t) => t.interval);
    expect(mergedMinutes(intervals)).toBe(45);
  });

  it("logMeeting non-billable stamps non_billable; rejects bad durations", async () => {
    const { task } = await logMeeting(
      { clientId: northwindId, title: "Internal sync", durationMinutes: 15, billable: false },
      danaId,
      TEST_TODAY,
    );
    expect(task.billableStatus).toBe("non_billable");

    await expect(
      logMeeting({ clientId: northwindId, title: "X", durationMinutes: 0, billable: false }, danaId, TEST_TODAY),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      logMeeting({ clientId: northwindId, title: "X", durationMinutes: 12.5, billable: false }, danaId, TEST_TODAY),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      logMeeting({ clientId: northwindId, title: " ", durationMinutes: 15, billable: false }, danaId, TEST_TODAY),
    ).rejects.toMatchObject({ status: 400 });
  });

  // ── Menu options ────────────────────────────────────────────────────────

  it("listQuickAddOptions returns active clients, staff only, and active templates", async () => {
    const template = await createAdHocTemplate(maraId, { title: "Quick-add test template", dueInDays: 3 });

    const options = await listQuickAddOptions();
    expect(options.clients.length).toBeGreaterThan(0);
    expect(options.clients.every((c) => c.name.length > 0)).toBe(true);

    // Portal roles (client/cpa logins) never appear in the assignee picker.
    const staffIds = new Set(options.staff.map((s) => s.id));
    expect(staffIds.has(maraId)).toBe(true);
    const activeUsers = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.isActive, true));
    const portalUsers = activeUsers.filter((u) => u.role === "client" || u.role === "cpa");
    expect(portalUsers.length).toBeGreaterThan(0);
    for (const u of portalUsers) expect(staffIds.has(u.id)).toBe(false);

    expect(options.templates.map((t) => t.id)).toContain(template.id);
    for (const t of options.templates) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.dueInDays).toBeGreaterThan(0);
    }
  });
});
