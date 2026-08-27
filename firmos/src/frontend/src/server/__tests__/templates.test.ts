import { and, eq } from "drizzle-orm";
import { addDays, formatLocalDate } from "@firmos/domain";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  clientManualEntries,
  clients,
  notifications,
  projects,
  projectTasks,
  recurringTaskSopLinks,
  tasks,
  users,
} from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import {
  addProjectTemplateTask,
  applySopToClient,
  createAdHocTemplate,
  createOffboardingTemplate,
  createOnboardingTemplate,
  createProjectFromTemplate,
  createProjectTemplate,
  createRecurringTemplate,
  createSopTemplate,
  finalizeOffboardingWhenComplete,
  getProjectTemplateWithTasks,
  linkSopToAdHocTemplate,
  listClientManualEntries,
  listOnboardingTemplates,
  mintAdHocTask,
  OFFBOARDING_PROJECT_NAME,
  startOffboarding,
  updateSopTemplate,
} from "@/server/templates";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

const ADMIN = "theo@blueledgerbooks.com";
const MANAGER = "dana@blueledgerbooks.com";
const BOOKKEEPER = "jorge@blueledgerbooks.com";

let theoId: number;
let danaId: number;
let jorgeId: number;
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

describe.skipIf(!reachable)("templates engine (HANDOFF §19, §22)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    theoId = await userIdByEmail(ADMIN);
    danaId = await userIdByEmail(MANAGER);
    jorgeId = await userIdByEmail(BOOKKEEPER);
    harborlineId = await clientIdByName("Harborline Marine Supply");
    northwindId = await clientIdByName("Northwind Frame & Door");
  });

  // ── SOPs: apply mirrors a linked manual entry; edits propagate (§19) ──

  it("applySopToClient creates a linked manual entry, and SOP edits propagate to it", async () => {
    const sop = await createSopTemplate(theoId, { title: "Bank feed triage", content: "Step 1: open the feed." });
    const entry = await applySopToClient(danaId, sop.id, harborlineId);

    expect(entry.clientId).toBe(harborlineId);
    expect(entry.sopTemplateId).toBe(sop.id);
    expect(entry.title).toBe("Bank feed triage");
    expect(entry.content).toBe("Step 1: open the feed.");

    // The SOP-to-entry bridge row exists (§7).
    const links = await db
      .select()
      .from(recurringTaskSopLinks)
      .where(
        and(eq(recurringTaskSopLinks.sopTemplateId, sop.id), eq(recurringTaskSopLinks.clientManualEntryId, entry.id)),
      );
    expect(links.length).toBe(1);

    // Mirror semantics: the edit propagates to the linked entry.
    await updateSopTemplate(theoId, sop.id, { title: "Bank feed triage v2", content: "Step 1: reconcile first." });
    const [updated] = await db.select().from(clientManualEntries).where(eq(clientManualEntries.id, entry.id)).limit(1);
    expect(updated.title).toBe("Bank feed triage v2");
    expect(updated.content).toBe("Step 1: reconcile first.");
    expect(updated.sopTemplateId).toBe(sop.id); // still linked

    const manual = await listClientManualEntries(harborlineId);
    expect(manual.map((m) => m.id)).toContain(entry.id);
  });

  // ── Ad-hoc mint: status 'new', derived assignee + due, SOP links copied ──

  it("mintAdHocTask lands in default lists with derived assignee and due date", async () => {
    const sop = await createSopTemplate(theoId, { title: "1099 prep SOP", content: "Collect W-9s." });
    const template = await createAdHocTemplate(theoId, {
      title: "Chase missing W-9",
      description: "Follow up with the vendor.",
      defaultAssigneeRole: "bookkeeper",
      dueInDays: 5,
    });
    await linkSopToAdHocTemplate(sop.id, template.id);

    const expectedDue = addDays(TEST_TODAY, 5);
    const task = await mintAdHocTask(template.id, harborlineId, theoId, TEST_TODAY);

    // The original minted 'open', hiding the task from default lists - fixed.
    expect(task.status).toBe("new");
    expect(task.taskType).toBe("ad_hoc");
    expect(task.clientId).toBe(harborlineId);
    // Role-derived assignee: Harborline's bookkeeper is Jorge.
    expect(task.assigneeId).toBe(jorgeId);
    expect(task.dueDate).toBe(formatLocalDate(expectedDue));
    // Attributed period is stamped so queue bucketing sees it.
    expect(task.attributedYear).not.toBeNull();
    expect(task.attributedMonth).not.toBeNull();

    // SOP links copied from the template onto the minted task.
    const taskLinks = await db
      .select()
      .from(recurringTaskSopLinks)
      .where(and(eq(recurringTaskSopLinks.taskId, task.id), eq(recurringTaskSopLinks.sopTemplateId, sop.id)));
    expect(taskLinks.length).toBe(1);

    // Assignee notified.
    const jorgeNotices = await db
      .select({ notificationType: notifications.notificationType, entityId: notifications.entityId })
      .from(notifications)
      .where(eq(notifications.userId, jorgeId));
    expect(jorgeNotices.some((n) => n.notificationType === "task_assigned" && n.entityId === task.id)).toBe(true);
  });

  it("mintAdHocTask prefers an explicit default_assignee_id and honors overrides", async () => {
    const template = await createAdHocTemplate(theoId, {
      title: "Manager-only follow-up",
      defaultAssigneeId: danaId,
      defaultAssigneeRole: "bookkeeper",
      dueInDays: 3,
    });
    const task = await mintAdHocTask(template.id, harborlineId, theoId, TEST_TODAY);
    expect(task.assigneeId).toBe(danaId);

    const overridden = await mintAdHocTask(template.id, harborlineId, theoId, TEST_TODAY, { assigneeId: jorgeId });
    expect(overridden.assigneeId).toBe(jorgeId);
  });

  // ── Template CRUD smoke: recurring + onboarding (§19 systems 3+4) ──

  it("recurring and onboarding template CRUD round-trips", async () => {
    const recurring = await createRecurringTemplate(theoId, {
      title: "Monthly close review",
      scheduleType: "monthly",
      dayOfMonth: 15,
      defaultAssigneeRole: "manager",
    });
    expect(recurring.isActive).toBe(true);

    const onboarding = await createOnboardingTemplate(theoId, {
      title: "Verify EIN letter",
      isAdminPhase: true,
      defaultAssigneeRole: "manager",
    });
    const all = await listOnboardingTemplates(true);
    // The seed ships 8 onboarding template rows; ours is the 9th.
    expect(all.some((t) => t.id === onboarding.id)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(9);
  });

  // ── Project templates: spawn with prerequisite chains (§19 system 6) ──

  it("createProjectFromTemplate spawns project tasks with the prerequisite chain remapped", async () => {
    const template = await createProjectTemplate(theoId, { name: "Catch-up bookkeeping" });
    const first = await addProjectTemplateTask(theoId, template.id, { title: "Collect statements", position: 0 });
    const second = await addProjectTemplateTask(theoId, template.id, {
      title: "Reconcile each month",
      position: 1,
      prerequisiteId: first.id,
      defaultAssigneeRole: "bookkeeper",
    });
    const third = await addProjectTemplateTask(theoId, template.id, {
      title: "Review with client",
      position: 2,
      prerequisiteId: second.id,
      defaultAssigneeRole: "manager",
    });

    // Prerequisite must live in the same template.
    const other = await createProjectTemplate(theoId, { name: "Other" });
    const outsider = await addProjectTemplateTask(theoId, other.id, { title: "Unrelated", position: 0 });
    await expect(
      addProjectTemplateTask(theoId, template.id, { title: "Bad chain", prerequisiteId: outsider.id }),
    ).rejects.toMatchObject({ status: 400 });

    const { project, tasksSpawned } = await createProjectFromTemplate(
      harborlineId,
      template.id,
      "Harborline catch-up",
      theoId,
    );
    expect(tasksSpawned).toBe(3);
    expect(project.templateId).toBe(template.id);

    const spawned = await db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.projectId, project.id))
      .orderBy(projectTasks.position);
    expect(spawned.map((t) => t.title)).toEqual(["Collect statements", "Reconcile each month", "Review with client"]);
    // Chain remapped onto the NEW ids, not the template ids.
    expect(spawned[0].prerequisiteId).toBeNull();
    expect(spawned[1].prerequisiteId).toBe(spawned[0].id);
    expect(spawned[2].prerequisiteId).toBe(spawned[1].id);
    expect(spawned[1].assigneeId).toBe(jorgeId);
    expect(spawned[2].assigneeId).toBe(danaId);

    const { tasks: templateTaskRows } = await getProjectTemplateWithTasks(template.id);
    expect(templateTaskRows.length).toBe(3);
  });

  // ── Offboarding lifecycle (§22) ──

  it("startOffboarding creates the Offboarding project; finalize deactivates only when every task completes", async () => {
    await createOffboardingTemplate(theoId, { title: "Export final reports", defaultAssigneeRole: "bookkeeper", position: 0 });
    await createOffboardingTemplate(theoId, { title: "Revoke QBO access", defaultAssigneeRole: "manager", position: 1 });

    const { project, tasksCreated } = await startOffboarding(northwindId, theoId);
    expect(project.name).toBe(OFFBOARDING_PROJECT_NAME);
    expect(tasksCreated).toBe(2);

    // Double-start is blocked while one is in progress.
    await expect(startOffboarding(northwindId, theoId)).rejects.toMatchObject({ status: 409 });

    // Not all complete: no finalization, client still active.
    const spawned = await db.select().from(projectTasks).where(eq(projectTasks.projectId, project.id));
    expect(spawned.length).toBe(2);
    expect(spawned.find((t) => t.title === "Export final reports")?.assigneeId).not.toBeNull();
    expect((await finalizeOffboardingWhenComplete(northwindId, theoId)).finalized).toBe(false);
    let [client] = await db.select().from(clients).where(eq(clients.id, northwindId)).limit(1);
    expect(client.isActive).toBe(true);

    // Complete one of two: still not finalized.
    await db
      .update(projectTasks)
      .set({ isCompleted: true, completedAt: new Date(), completedById: jorgeId })
      .where(eq(projectTasks.id, spawned[0].id));
    expect((await finalizeOffboardingWhenComplete(northwindId, theoId)).finalized).toBe(false);

    // Last task completes: project completes and the client deactivates.
    await db
      .update(projectTasks)
      .set({ isCompleted: true, completedAt: new Date(), completedById: danaId })
      .where(eq(projectTasks.id, spawned[1].id));
    expect((await finalizeOffboardingWhenComplete(northwindId, theoId)).finalized).toBe(true);

    [client] = await db.select().from(clients).where(eq(clients.id, northwindId)).limit(1);
    expect(client.isActive).toBe(false);
    const [doneProject] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1);
    expect(doneProject.status).toBe("completed");
    expect(doneProject.completedAt).not.toBeNull();

    // Notifications fired at both steps (§16 types).
    const theoNotices = await db
      .select({ notificationType: notifications.notificationType })
      .from(notifications)
      .where(eq(notifications.userId, theoId));
    expect(theoNotices.some((n) => n.notificationType === "offboarding_completed")).toBe(true);

    // Idempotent afterwards.
    expect((await finalizeOffboardingWhenComplete(northwindId, theoId)).finalized).toBe(false);
  });
});
