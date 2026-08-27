import { and, eq } from "drizzle-orm";
import { formatLocalDate } from "@firmos/domain";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  accounts,
  auditEvents,
  clients,
  projects,
  projectTasks,
  recurringTasks,
  tasks,
  users,
} from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import {
  addProjectTask,
  catchUpRangesFor,
  CATCH_UP_NAME_PATTERN,
  createProject,
  PrerequisiteBlockedError,
  setProjectEngagement,
  setProjectTaskDone,
  setProjectTaskPeriod,
  updateProjectStatus,
} from "@/server/projects";
import { addProjectTemplateTask, createProjectTemplate } from "@/server/templates";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

const ADMIN = "theo@blueledgerbooks.com";
const MANAGER = "dana@blueledgerbooks.com";

let theoId: number;
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

async function projectTaskRows(projectId: number) {
  return db.select().from(projectTasks).where(eq(projectTasks.projectId, projectId));
}

async function projectRow(projectId: number) {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) throw new Error(`project ${projectId} not found`);
  return row;
}

describe.skipIf(!reachable)("projects engine (HANDOFF §20, §6.2)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    theoId = await userIdByEmail(ADMIN);
    danaId = await userIdByEmail(MANAGER);
    harborlineId = await clientIdByName("Harborline Marine Supply");
    northwindId = await clientIdByName("Northwind Frame & Door");
  });

  // ── Template spawn with prerequisite chains (§19/§20) ───────────────────

  it("createProject from a template spawns tasks with remapped prerequisite chains", async () => {
    const template = await createProjectTemplate(theoId, { name: "Catch-up checklist" });
    const first = await addProjectTemplateTask(theoId, template.id, { title: "Collect statements", position: 0 });
    const second = await addProjectTemplateTask(theoId, template.id, {
      title: "Reconcile accounts",
      prerequisiteId: first.id,
      position: 1,
    });
    const third = await addProjectTemplateTask(theoId, template.id, {
      title: "Review with client",
      prerequisiteId: second.id,
      position: 2,
    });

    const result = await createProject(harborlineId, { name: "Q3 review", templateId: template.id }, theoId);
    expect(result.tasksSpawned).toBe(3);

    const rows = await projectTaskRows(result.project.id);
    expect(rows).toHaveLength(3);
    const byTitle = new Map(rows.map((r) => [r.title, r]));
    // The chain survives the copy: template ids are remapped to the new
    // project_tasks ids (spawnProjectTasks two-pass remap).
    expect(byTitle.get("Collect statements")!.prerequisiteId).toBeNull();
    expect(byTitle.get("Reconcile accounts")!.prerequisiteId).toBe(byTitle.get("Collect statements")!.id);
    expect(byTitle.get("Review with client")!.prerequisiteId).toBe(byTitle.get("Reconcile accounts")!.id);
    expect(result.project.status).toBe("pending");
  });

  // ── Auto-advance, both directions (§20) ──────────────────────────────────

  it("completing every task completes the project; re-opening one moves it back", async () => {
    const { project } = await createProject(northwindId, { name: "Annual consulting" }, theoId);
    const a = await addProjectTask(project.id, { title: "Scope the work" }, theoId);
    const b = await addProjectTask(project.id, { title: "Deliver the report" }, theoId);

    let res = await setProjectTaskDone(a.id, true, danaId);
    expect(res.projectStatus).toBe("pending"); // one still open - no auto-advance
    res = await setProjectTaskDone(b.id, true, danaId);
    expect(res.projectStatus).toBe("completed");
    const completed = await projectRow(project.id);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();

    res = await setProjectTaskDone(a.id, false, danaId);
    expect(res.projectStatus).toBe("in_progress");
    const reopened = await projectRow(project.id);
    expect(reopened.status).toBe("in_progress");
    expect(reopened.completedAt).toBeNull();
  });

  // ── Prerequisite enforcement (§20 typed error) ───────────────────────────

  it("blocks completing a task whose prerequisite is incomplete, then allows it", async () => {
    const { project } = await createProject(northwindId, { name: "Systems audit" }, theoId);
    const first = await addProjectTask(project.id, { title: "Gather documents" }, theoId);
    const second = await addProjectTask(project.id, { title: "Write findings", prerequisiteId: first.id }, theoId);

    await expect(setProjectTaskDone(second.id, true, danaId)).rejects.toBeInstanceOf(PrerequisiteBlockedError);
    await expect(setProjectTaskDone(second.id, true, danaId)).rejects.toThrow(
      /blocked until "Gather documents" is complete/,
    );

    await setProjectTaskDone(first.id, true, danaId);
    const res = await setProjectTaskDone(second.id, true, danaId);
    expect(res.projectStatus).toBe("completed");
  });

  it("addProjectTask validates the prerequisite is in the same project", async () => {
    const { project: p1 } = await createProject(northwindId, { name: "P1" }, theoId);
    const { project: p2 } = await createProject(northwindId, { name: "P2" }, theoId);
    const foreign = await addProjectTask(p1.id, { title: "Foreign task" }, theoId);
    await expect(
      addProjectTask(p2.id, { title: "Bad chain", prerequisiteId: foreign.id }, theoId),
    ).rejects.toThrow(/same project/);
  });

  // ── time_period per-period completion (§20 monthly grid) ────────────────

  it("time_period rows complete when all 12 target-year periods complete, and auto-advance applies", async () => {
    const { project } = await createProject(harborlineId, { name: "2025 catch-up cleanup" }, theoId);
    const row = await addProjectTask(project.id, { title: "Operating Checking - 2025 catch-up", taskKind: "time_period" }, theoId);

    // Eleven months in, the row and the project are still open.
    for (let month = 1; month <= 11; month++) {
      await setProjectTaskPeriod(row.id, 2025, month, true, danaId);
    }
    let stored = (await projectTaskRows(project.id))[0];
    expect(stored.isCompleted).toBe(false);
    const completions = stored.periodCompletions as Record<string, { completed_by_id: number }>;
    expect(Object.keys(completions)).toHaveLength(11);
    expect(completions["2025-03"].completed_by_id).toBe(danaId);

    // The twelfth month completes the row and the project.
    const res = await setProjectTaskPeriod(row.id, 2025, 12, true, danaId);
    expect(res.rowCompleted).toBe(true);
    expect(res.projectStatus).toBe("completed");
    stored = (await projectTaskRows(project.id))[0];
    expect(stored.isCompleted).toBe(true);
    expect(stored.completedById).toBe(danaId);

    // Un-completing one period re-opens the row and the project.
    const back = await setProjectTaskPeriod(row.id, 2025, 12, false, danaId);
    expect(back.rowCompleted).toBe(false);
    expect(back.projectStatus).toBe("in_progress");
    stored = (await projectTaskRows(project.id))[0];
    expect(stored.isCompleted).toBe(false);
    expect(stored.completedAt).toBeNull();
  });

  it("enforces the prerequisite chain when the last period would complete the row", async () => {
    const { project } = await createProject(harborlineId, { name: "Chained grids" }, theoId);
    const gate = await addProjectTask(project.id, { title: "Sign the engagement letter" }, theoId);
    const grid = await addProjectTask(
      project.id,
      { title: "Amex - 2025 catch-up", taskKind: "time_period", prerequisiteId: gate.id },
      theoId,
    );
    for (let month = 1; month <= 11; month++) {
      await setProjectTaskPeriod(grid.id, 2025, month, true, danaId);
    }
    await expect(setProjectTaskPeriod(grid.id, 2025, 12, true, danaId)).rejects.toBeInstanceOf(
      PrerequisiteBlockedError,
    );
    // The twelfth period was not written - partial progress stands at 11.
    const stored = (await projectTaskRows(project.id)).find((t) => t.id === grid.id)!;
    expect(Object.keys(stored.periodCompletions as Record<string, unknown>)).toHaveLength(11);
    expect(stored.isCompleted).toBe(false);
  });

  it("rejects period toggles on one_off rows and invalid months", async () => {
    const { project } = await createProject(harborlineId, { name: "Guard rails" }, theoId);
    const oneOff = await addProjectTask(project.id, { title: "Plain task" }, theoId);
    await expect(setProjectTaskPeriod(oneOff.id, 2025, 1, true, danaId)).rejects.toThrow(
      /time-period tasks only/,
    );
    const grid = await addProjectTask(project.id, { title: "Grid 2025", taskKind: "time_period" }, theoId);
    await expect(setProjectTaskPeriod(grid.id, 2025, 13, true, danaId)).rejects.toThrow(/Invalid period month/);
  });

  // ── Catch-up suggestion + auto-generation (§20) ─────────────────────────

  it("catchUpRangesFor suggests yearly ranges from the start date through the month before today", () => {
    // Books start mid-2024, today is Aug 2026: full 2024 partial, full 2025,
    // partial 2026 (Jan-Jul - regular work owns August).
    expect(catchUpRangesFor({ year: 2024, month: 6, day: 1 }, { year: 2026, month: 8, day: 15 })).toEqual([
      { year: 2024, fromMonth: 6, toMonth: 12 },
      { year: 2025, fromMonth: 1, toMonth: 12 },
      { year: 2026, fromMonth: 1, toMonth: 7 },
    ]);
    // Started this month: nothing to catch up.
    expect(catchUpRangesFor({ year: 2026, month: 8, day: 3 }, { year: 2026, month: 8, day: 15 })).toEqual([]);
    // Started in January this year: one partial range.
    expect(catchUpRangesFor({ year: 2026, month: 1, day: 1 }, { year: 2026, month: 8, day: 15 })).toEqual([
      { year: 2026, fromMonth: 1, toMonth: 7 },
    ]);
  });

  it("the catch-up name heuristic matches catch-up and retro names only", () => {
    expect(CATCH_UP_NAME_PATTERN.test("2025 books catch-up")).toBe(true);
    expect(CATCH_UP_NAME_PATTERN.test("Catchup - prior years")).toBe(true);
    expect(CATCH_UP_NAME_PATTERN.test("Retroactive cleanup")).toBe(true);
    expect(CATCH_UP_NAME_PATTERN.test("Monthly close")).toBe(false);
    expect(CATCH_UP_NAME_PATTERN.test("Systems audit")).toBe(false);
  });

  it("createProject with detectCatchUp generates one time_period task per active account per year", async () => {
    // Harborline starts 2026-01-01 with three active accounts; at TEST_TODAY
    // (2026-08-15) the suggested range is the single partial year 2026.
    const result = await createProject(
      harborlineId,
      { name: "Harborline catch-up", detectCatchUp: true },
      theoId,
      TEST_TODAY,
    );
    expect(result.catchUpRanges).toEqual([{ year: 2026, fromMonth: 1, toMonth: 7 }]);
    expect(result.catchUpTasksGenerated).toBe(3);
    expect(result.project.autoGenerateTasks).toBe(true);

    const rows = await projectTaskRows(result.project.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.taskKind === "time_period")).toBe(true);
    const titles = rows.map((r) => r.title).sort();
    expect(titles).toEqual([
      "Business Credit Card - 2026 catch-up",
      "Operating Checking - 2026 catch-up",
      "Payroll Checking - 2026 catch-up",
    ]);
  });

  it("does not generate catch-up tasks when the name does not suggest catch-up or detection is off", async () => {
    const plain = await createProject(harborlineId, { name: "Monthly review", detectCatchUp: true }, theoId, TEST_TODAY);
    expect(plain.catchUpTasksGenerated).toBe(0);
    expect(plain.project.autoGenerateTasks).toBe(false);

    const off = await createProject(harborlineId, { name: "Retro books", detectCatchUp: false }, theoId, TEST_TODAY);
    expect(off.catchUpTasksGenerated).toBe(0);
    expect(off.project.autoGenerateTasks).toBe(false);
  });

  // ── Manual status transitions (§20) ──────────────────────────────────────

  it("updateProjectStatus guards completion and cancellation transitions", async () => {
    const { project } = await createProject(northwindId, { name: "Status rules" }, theoId);
    const open = await addProjectTask(project.id, { title: "Open task" }, theoId);

    // Cannot complete with an open task.
    await expect(updateProjectStatus(project.id, "completed", theoId)).rejects.toThrow(
      /Every project task must be complete/,
    );
    const started = await updateProjectStatus(project.id, "in_progress", theoId);
    expect(started.status).toBe("in_progress");

    await setProjectTaskDone(open.id, true, danaId); // auto-completes the project
    // A completed project cannot be cancelled directly.
    await expect(updateProjectStatus(project.id, "cancelled", theoId)).rejects.toThrow(/re-open it first/);

    const reopened = await updateProjectStatus(project.id, "in_progress", theoId);
    expect(reopened.status).toBe("in_progress");
    const cancelled = await updateProjectStatus(project.id, "cancelled", theoId);
    expect(cancelled.status).toBe("cancelled");
    // Cancelled is terminal-ish: the only way out is re-opening.
    await expect(updateProjectStatus(project.id, "pending", theoId)).rejects.toThrow(/re-opened to in progress/);
    // Task mutations freeze on a cancelled project.
    await expect(setProjectTaskDone(open.id, false, danaId)).rejects.toThrow(/cancelled project/);
    await expect(addProjectTask(project.id, { title: "Nope" }, theoId)).rejects.toThrow(/cancelled project/);
  });

  // ── Project engagement flip (§6.2) ───────────────────────────────────────

  it("enable stamps the cutoff, turns feeds off, disables rules, and soft-deletes untouched future instances", async () => {
    // Controlled fixture on Northwind: one active rule, three instances -
    // a past untouched one (period ends before the cutoff), a future
    // untouched one (ends after), and a future COMPLETED one (touched).
    const [rule] = await db
      .insert(recurringTasks)
      .values({ clientId: northwindId, title: "Reconcile Accounts", scheduleType: "monthly", isActive: true })
      .returning();
    const [pastInstance] = await db
      .insert(tasks)
      .values({
        clientId: northwindId,
        recurringTaskId: rule.id,
        title: "Reconcile Accounts",
        taskType: "recurring",
        status: "open",
        dueDate: "2026-08-05",
        attributedYear: 2026,
        attributedMonth: 7,
      })
      .returning();
    const [futureInstance] = await db
      .insert(tasks)
      .values({
        clientId: northwindId,
        recurringTaskId: rule.id,
        title: "Reconcile Accounts",
        taskType: "recurring",
        status: "open",
        dueDate: "2026-10-05",
        attributedYear: 2026,
        attributedMonth: 9,
      })
      .returning();
    const [touchedInstance] = await db
      .insert(tasks)
      .values({
        clientId: northwindId,
        recurringTaskId: rule.id,
        title: "Reconcile Accounts",
        taskType: "recurring",
        status: "completed",
        completedAt: new Date(),
        completedById: danaId,
        dueDate: "2026-11-05",
        attributedYear: 2026,
        attributedMonth: 10,
      })
      .returning();

    const result = await setProjectEngagement(northwindId, true, theoId, TEST_TODAY);
    expect(result.changed).toBe(true);
    expect(result.cutoffDate).toBe(formatLocalDate(TEST_TODAY));
    expect(result.rulesDisabled).toBeGreaterThanOrEqual(1);
    expect(result.instancesRemoved).toBeGreaterThanOrEqual(1);

    const [client] = await db.select().from(clients).where(eq(clients.id, northwindId)).limit(1);
    expect(client.isProjectEngagement).toBe(true);
    expect(client.projectCutoffDate).toBe(formatLocalDate(TEST_TODAY));
    expect(client.requiresWeeklyBankFeeds).toBe(false);

    const [disabledRule] = await db.select().from(recurringTasks).where(eq(recurringTasks.id, rule.id)).limit(1);
    expect(disabledRule.isActive).toBe(false);

    // Period-end semantics via the domain rule: July 31 ends before the Aug
    // 15 cutoff (kept); September 30 ends after (soft-deleted); the completed
    // October instance is touched and never removed.
    const [past] = await db.select().from(tasks).where(eq(tasks.id, pastInstance.id)).limit(1);
    expect(past.deletedAt).toBeNull();
    const [future] = await db.select().from(tasks).where(eq(tasks.id, futureInstance.id)).limit(1);
    expect(future.deletedAt).not.toBeNull();
    const [touched] = await db.select().from(tasks).where(eq(tasks.id, touchedInstance.id)).limit(1);
    expect(touched.deletedAt).toBeNull();

    const audit = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "project_engagement_enabled"), eq(auditEvents.entityId, northwindId)));
    expect(audit.length).toBeGreaterThanOrEqual(1);
    const details = audit[audit.length - 1].details as { cutoffDate?: string; instancesRemoved?: number };
    expect(details.cutoffDate).toBe(formatLocalDate(TEST_TODAY));

    // Disable clears the flag only (rules and feeds stay off by design).
    const off = await setProjectEngagement(northwindId, false, theoId, TEST_TODAY);
    expect(off.changed).toBe(true);
    const [cleared] = await db.select().from(clients).where(eq(clients.id, northwindId)).limit(1);
    expect(cleared.isProjectEngagement).toBe(false);
    expect(cleared.projectCutoffDate).toBeNull();
    expect(cleared.requiresWeeklyBankFeeds).toBe(false);
    const [stillDisabled] = await db.select().from(recurringTasks).where(eq(recurringTasks.id, rule.id)).limit(1);
    expect(stillDisabled.isActive).toBe(false);

    const offAudit = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "project_engagement_disabled"), eq(auditEvents.entityId, northwindId)));
    expect(offAudit.length).toBeGreaterThanOrEqual(1);

    // No-op guard: flipping to the current state changes nothing.
    const noop = await setProjectEngagement(northwindId, false, theoId, TEST_TODAY);
    expect(noop.changed).toBe(false);
  });

  it("ad-hoc (non-recurring) tasks are never soft-deleted by the cutoff", async () => {
    const [rule] = await db
      .insert(recurringTasks)
      .values({ clientId: harborlineId, title: "Categorize Transactions", scheduleType: "monthly", isActive: true })
      .returning();
    const [recurringInstance] = await db
      .insert(tasks)
      .values({
        clientId: harborlineId,
        recurringTaskId: rule.id,
        title: "Categorize Transactions",
        taskType: "recurring",
        status: "open",
        dueDate: "2026-12-05",
        attributedYear: 2026,
        attributedMonth: 12,
      })
      .returning();
    const [adHoc] = await db
      .insert(tasks)
      .values({
        clientId: harborlineId,
        title: "One-off cleanup question",
        taskType: "ad_hoc",
        status: "new",
        dueDate: "2026-12-15",
        attributedYear: 2026,
        attributedMonth: 12,
      })
      .returning();
    await setProjectEngagement(harborlineId, true, theoId, TEST_TODAY);
    const [storedAdHoc] = await db.select().from(tasks).where(eq(tasks.id, adHoc.id)).limit(1);
    expect(storedAdHoc.deletedAt).toBeNull();
    const [storedRecurring] = await db.select().from(tasks).where(eq(tasks.id, recurringInstance.id)).limit(1);
    expect(storedRecurring.deletedAt).not.toBeNull();
  });
});
