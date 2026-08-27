"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { clients } from "@/db/schema";
import { AuthError, requireRole, requireStaff } from "@/server/auth/guards";
import {
  addProjectTask,
  createProject,
  setProjectEngagement,
  setProjectTaskDone,
  setProjectTaskPeriod,
  suggestCatchUpRanges,
  updateProjectBilling,
  updateProjectStatus,
  type AddProjectTaskInput,
  type CreateProjectInput,
  type ProjectBillingMode,
  type ProjectStatus,
} from "@/server/projects";

/**
 * Project server actions (HANDOFF §20, §6.2). Staff-level for CRUD and task
 * completion; billing_mode changes are manager+ (money-relevant, §11); the
 * project-engagement flip is admin/owner or the client's manager (same
 * guard shape as startOffboardingAction, §22).
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

function revalidateProject(projectId: number, clientId?: number) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  if (clientId != null) revalidatePath(`/clients/${clientId}`);
}

export async function createProjectAction(
  clientId: number,
  input: CreateProjectInput,
): Promise<ActionResult<Awaited<ReturnType<typeof createProject>>>> {
  try {
    const user = await requireStaff();
    const result = await createProject(clientId, input, user.id);
    revalidateProject(result.project.id, clientId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

export async function updateProjectStatusAction(
  projectId: number,
  status: ProjectStatus,
): Promise<ActionResult<Awaited<ReturnType<typeof updateProjectStatus>>>> {
  try {
    const user = await requireStaff();
    const project = await updateProjectStatus(projectId, status, user.id);
    revalidateProject(projectId, project.clientId);
    return { ok: true, data: project };
  } catch (error) {
    return fail(error);
  }
}

export async function updateProjectBillingAction(
  projectId: number,
  patch: { billingMode?: ProjectBillingMode; fixedPrice?: string | null },
): Promise<ActionResult<Awaited<ReturnType<typeof updateProjectBilling>>>> {
  try {
    const user = await requireRole("owner", "admin", "manager");
    const project = await updateProjectBilling(projectId, patch, user.id);
    revalidateProject(projectId, project.clientId);
    return { ok: true, data: project };
  } catch (error) {
    return fail(error);
  }
}

export async function addProjectTaskAction(
  projectId: number,
  input: AddProjectTaskInput,
): Promise<ActionResult<Awaited<ReturnType<typeof addProjectTask>>>> {
  try {
    const user = await requireStaff();
    const task = await addProjectTask(projectId, input, user.id);
    revalidateProject(projectId);
    return { ok: true, data: task };
  } catch (error) {
    return fail(error);
  }
}

/** one_off completion; prerequisite chains enforced in the engine (§20). */
export async function setProjectTaskDoneAction(
  projectTaskId: number,
  completed: boolean,
): Promise<ActionResult<Awaited<ReturnType<typeof setProjectTaskDone>>>> {
  try {
    const user = await requireStaff();
    const result = await setProjectTaskDone(projectTaskId, completed, user.id);
    revalidateProject(result.projectId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** time_period per-period toggle (§20 monthly grid). */
export async function setProjectTaskPeriodAction(
  projectTaskId: number,
  year: number,
  month: number,
  completed: boolean,
): Promise<ActionResult<Awaited<ReturnType<typeof setProjectTaskPeriod>>>> {
  try {
    const user = await requireStaff();
    const result = await setProjectTaskPeriod(projectTaskId, year, month, completed, user.id);
    revalidateProject(result.projectId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** §20 detection endpoint for the new-project dialog's catch-up preview. */
export async function suggestCatchUpRangesAction(
  clientId: number,
): Promise<ActionResult<Awaited<ReturnType<typeof suggestCatchUpRanges>>>> {
  try {
    await requireStaff();
    return { ok: true, data: await suggestCatchUpRanges(clientId) };
  } catch (error) {
    return fail(error);
  }
}

/** §6.2 flip: admin/owner or the client's manager. */
export async function setProjectEngagementAction(
  clientId: number,
  enabled: boolean,
): Promise<ActionResult<Awaited<ReturnType<typeof setProjectEngagement>>>> {
  try {
    const actor = await requireStaff();
    const isAdmin = actor.normalizedRole === "admin" || actor.normalizedRole === "owner";
    if (!isAdmin) {
      const [client] = await db
        .select({ managerId: clients.managerId })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      if (!client || client.managerId !== actor.id) {
        throw new AuthError(403, "Only an admin, owner, or the client's manager can change project engagement");
      }
    }
    const result = await setProjectEngagement(clientId, enabled, actor.id);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}
