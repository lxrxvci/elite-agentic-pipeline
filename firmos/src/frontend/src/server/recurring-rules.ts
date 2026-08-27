import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import {
  assertGeneratesWork,
  compareLocalDate,
  formatLocalDate,
  nextRunFrom,
  parseDaysOfWeek,
  recurringBillingQuantityForMonth,
  type LocalDate,
  type RecurringRuleShape,
  type ScheduleType,
} from "@firmos/domain";

import { db } from "@/db";
import {
  clients,
  recurringTasks,
  recurringTaskSopLinks,
  recurringTaskSubtasks,
  tasks,
  users,
} from "@/db/schema";

import { logEvent } from "./audit";
import { onClientBillingFieldsChanged } from "./billing-sync";
import { localToday } from "./dates";
import { catchupOf, toDomainClient, type ClientRow } from "./domain-adapters";

/**
 * Per-client recurring rule management (HANDOFF §6.4) - the owner-facing
 * CRUD over the schedule rules that runRecurringOnce (src/server/recurring.ts)
 * turns into tasks. The owner edits rules here instead of asking for code
 * changes.
 *
 * HANDOFF §29 rules this module enforces on EVERY write path:
 *  - Create applies the pause/project client-state guard (the domain's
 *    assertGeneratesWork) and the catch-up-date floor: the first next_run is
 *    anchored at the later of today and the client's bank-feed catch-up date,
 *    so a mid-catch-up client never gets a rule that starts in the past.
 *  - A cadence change recomputes next_run AND retires stale off-cadence
 *    instances: untouched generated tasks whose attributed period is not a
 *    cadence month under the NEW schedule are soft-deleted (the original left
 *    them behind, so a monthly→quarterly edit kept phantom rows in every
 *    off-quarter month).
 *  - Pausing a rule only freezes generation (is_active=false); existing
 *    instances are untouched and resume catches up through the stored
 *    next_run, matching runRecurringOnce's frozen-rule semantics.
 *  - Delete is soft on history: a rule with completed instances can never be
 *    removed - it is deactivated instead and the caller gets a human message.
 *
 * Hand-created rules are custom rules (is_custom=true); custom billable
 * active rules feed the §15 custom_item_{n} template lines, so any write
 * that changes that set triggers the billing-sync resync.
 */

export class RecurringRuleError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "RecurringRuleError";
  }
}

const SCHEDULE_TYPES: readonly ScheduleType[] = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
];

/** Months per cadence step (mirrors the domain's private STEP_MONTHS). */
const STEP_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semi_annual: 6,
  annual: 12,
};

/** Statuses that count as "touched" - never soft-deleted by retirement. */
const TOUCHED_TASK_STATUSES = ["completed", "cancelled"] as const;

type RuleRow = typeof recurringTasks.$inferSelect;

// ── Input + validation ────────────────────────────────────────────────────

export interface RecurringRuleInput {
  title: string;
  description?: string | null;
  scheduleType: ScheduleType;
  /** Weekly cadence: 0 = Sunday. */
  daysOfWeek?: number[] | null;
  dayOfMonth?: number | null;
  /** 0 = Sunday; paired with weekOfMonth for "2nd Tuesday" schedules. */
  weekday?: number | null;
  /** 1-4, or -1 for last. */
  weekOfMonth?: number | null;
  /** 1-12; quarterly and longer. */
  anchorMonth?: number | null;
  assigneeId?: number | null;
  isBillable?: boolean;
  /** Decimal string ("250.00"); required when billable. */
  unitPrice?: string | null;
  /** Checklist template rows, one title each. */
  subtasks?: string[];
}

interface NormalizedSchedule {
  scheduleType: ScheduleType;
  daysOfWeek: string | null;
  dayOfMonth: number | null;
  weekday: number | null;
  weekOfMonth: number | null;
  anchorMonth: number | null;
}

function isIntInRange(n: unknown, lo: number, hi: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
}

/**
 * Per-type schedule validation (§6.4). Irrelevant fields are cleared so a
 * cadence switch never leaves stale day fields behind; invalid combinations
 * throw a human-readable 400.
 */
function validateSchedule(input: RecurringRuleInput): NormalizedSchedule {
  if (!SCHEDULE_TYPES.includes(input.scheduleType)) {
    throw new RecurringRuleError(400, `Unknown schedule type: ${String(input.scheduleType)}`);
  }
  const dayOfMonth = input.dayOfMonth ?? null;
  const weekday = input.weekday ?? null;
  const weekOfMonth = input.weekOfMonth ?? null;
  const anchorMonth = input.anchorMonth ?? null;

  if (dayOfMonth != null && !isIntInRange(dayOfMonth, 1, 31)) {
    throw new RecurringRuleError(400, "Day of month must be between 1 and 31.");
  }
  if (weekday != null && !isIntInRange(weekday, 0, 6)) {
    throw new RecurringRuleError(400, "Weekday must be 0 (Sunday) through 6 (Saturday).");
  }
  if (weekOfMonth != null && !(isIntInRange(weekOfMonth, 1, 4) || weekOfMonth === -1)) {
    throw new RecurringRuleError(400, "Week of month must be 1-4, or -1 for the last week.");
  }
  if (anchorMonth != null && !isIntInRange(anchorMonth, 1, 12)) {
    throw new RecurringRuleError(400, "Anchor month must be 1-12.");
  }

  switch (input.scheduleType) {
    case "daily":
      return {
        scheduleType: "daily",
        daysOfWeek: null,
        dayOfMonth: null,
        weekday: null,
        weekOfMonth: null,
        anchorMonth: null,
      };
    case "weekly": {
      const days = [...new Set((input.daysOfWeek ?? []).filter((d) => isIntInRange(d, 0, 6)))].sort(
        (a, b) => a - b,
      );
      if (days.length === 0) {
        throw new RecurringRuleError(400, "Pick at least one day of the week.");
      }
      return {
        scheduleType: "weekly",
        daysOfWeek: days.join(","),
        dayOfMonth: null,
        weekday: null,
        weekOfMonth: null,
        anchorMonth: null,
      };
    }
    default: {
      if (dayOfMonth != null && (weekday != null || weekOfMonth != null)) {
        throw new RecurringRuleError(
          400,
          "Choose either a day of the month or an nth weekday, not both.",
        );
      }
      if ((weekday == null) !== (weekOfMonth == null)) {
        throw new RecurringRuleError(400, "An nth-weekday schedule needs both a week and a weekday.");
      }
      return {
        scheduleType: input.scheduleType,
        daysOfWeek: null,
        dayOfMonth,
        weekday,
        weekOfMonth,
        // Anchor only means something on quarterly and longer (§6.4).
        anchorMonth: input.scheduleType === "monthly" ? null : anchorMonth,
      };
    }
  }
}

function validateBilling(input: RecurringRuleInput): { isBillable: boolean; unitPrice: string | null } {
  const isBillable = input.isBillable === true;
  if (!isBillable) return { isBillable: false, unitPrice: null };
  const amount = Number(input.unitPrice);
  if (input.unitPrice == null || input.unitPrice.trim() === "" || !Number.isFinite(amount) || amount <= 0) {
    throw new RecurringRuleError(400, "A billable rule needs a unit price above zero.");
  }
  return { isBillable: true, unitPrice: amount.toFixed(2) };
}

function normalizeSubtasks(subtasks: string[] | undefined): string[] {
  return (subtasks ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
}

// ── next_run math (catch-up floor per §29) ────────────────────────────────

/**
 * The anchor for a rule's first/recomputed next_run: today, pushed forward
 * to the catch-up floor when the floor is still in the future ("everything
 * older than this is due by this date", §32). The generation engine floors
 * due dates per occurrence; creation must not schedule the first run inside
 * the floored span (§29: the original API path skipped the floor entirely).
 */
function floorAnchor(client: ClientRow, today: LocalDate): LocalDate {
  const catchup = catchupOf(client);
  if (catchup && compareLocalDate(catchup, today) > 0) return catchup;
  return today;
}

function toRuleShape(schedule: NormalizedSchedule): RecurringRuleShape {
  return {
    schedule_type: schedule.scheduleType,
    days_of_week: schedule.daysOfWeek,
    day_of_month: schedule.dayOfMonth,
    weekday: schedule.weekday,
    week_of_month: schedule.weekOfMonth,
    anchor_month: schedule.anchorMonth,
  };
}

// ── Off-cadence retirement (the §29 cadence-change fix) ──────────────────

/**
 * True when an attributed (year, month) period can contain an occurrence of
 * the schedule. Daily and weekly rules touch every month, so nothing is ever
 * off-cadence for them; month-based rules only touch their anchor cadence.
 */
export function periodMatchesCadence(
  schedule: Pick<NormalizedSchedule, "scheduleType" | "anchorMonth">,
  year: number,
  month: number,
): boolean {
  void year;
  const step = STEP_MONTHS[schedule.scheduleType];
  if (step == null) return true; // daily / weekly
  if (schedule.anchorMonth == null) return true; // unanchored: every step month
  const diff = month - schedule.anchorMonth;
  return ((diff % step) + step) % step === 0;
}

/**
 * Soft-delete untouched generated instances whose attributed period is dead
 * under the new cadence. Completed and cancelled instances are history and
 * are never touched; instances without a stored period are kept (the
 * generator always stamps one, so this is defensive).
 */
async function retireOffCadenceInstances(
  ruleId: number,
  schedule: NormalizedSchedule,
  now: Date,
): Promise<number> {
  const candidates = await db
    .select({
      id: tasks.id,
      attributedYear: tasks.attributedYear,
      attributedMonth: tasks.attributedMonth,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.recurringTaskId, ruleId),
        isNull(tasks.deletedAt),
        notInArray(tasks.status, [...TOUCHED_TASK_STATUSES]),
      ),
    );
  const stale = candidates.filter(
    (t) =>
      t.attributedYear != null &&
      t.attributedMonth != null &&
      !periodMatchesCadence(schedule, t.attributedYear, t.attributedMonth),
  );
  if (stale.length === 0) return 0;
  for (const t of stale) {
    await db.update(tasks).set({ deletedAt: now, updatedAt: now }).where(eq(tasks.id, t.id));
  }
  return stale.length;
}

// ── Reads ─────────────────────────────────────────────────────────────────

export interface ClientRuleListItem {
  id: number;
  title: string;
  description: string | null;
  scheduleType: ScheduleType;
  /** Parsed weekday numbers, 0 = Sunday (weekly rules). */
  daysOfWeek: number[];
  dayOfMonth: number | null;
  weekday: number | null;
  weekOfMonth: number | null;
  anchorMonth: number | null;
  nextRun: string | null;
  isActive: boolean;
  assigneeId: number | null;
  assigneeName: string | null;
  isBillable: boolean;
  unitPrice: string | null;
  isCustom: boolean;
  subtasks: string[];
  subtaskCount: number;
  sopLinkCount: number;
  /** Occurrences this month when billable (domain billing quantity), else null. */
  billingQtyThisMonth: number | null;
}

export async function listClientRules(
  clientId: number,
  today: LocalDate = localToday(),
): Promise<ClientRuleListItem[]> {
  const rules = await db
    .select()
    .from(recurringTasks)
    .where(eq(recurringTasks.clientId, clientId))
    .orderBy(asc(recurringTasks.position), asc(recurringTasks.id));
  if (rules.length === 0) return [];

  const ruleIds = rules.map((r) => r.id);
  const [subtaskRows, sopRows, staffRows] = await Promise.all([
    db
      .select()
      .from(recurringTaskSubtasks)
      .where(inArray(recurringTaskSubtasks.recurringTaskId, ruleIds)),
    db
      .select()
      .from(recurringTaskSopLinks)
      .where(inArray(recurringTaskSopLinks.recurringTaskId, ruleIds)),
    db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users),
  ]);
  const nameById = new Map(
    staffRows.map((u) => [u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || `Staff ${u.id}`] as const),
  );

  return rules.map((rule) => {
    const subtasks = subtaskRows
      .filter((s) => s.recurringTaskId === rule.id)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const shape: RecurringRuleShape = {
      schedule_type: rule.scheduleType,
      days_of_week: rule.daysOfWeek,
      day_of_month: rule.dayOfMonth,
      weekday: rule.weekday,
      week_of_month: rule.weekOfMonth,
      anchor_month: rule.anchorMonth,
    };
    return {
      id: rule.id,
      title: rule.title,
      description: rule.description,
      scheduleType: rule.scheduleType,
      daysOfWeek: parseDaysOfWeek(rule.daysOfWeek),
      dayOfMonth: rule.dayOfMonth,
      weekday: rule.weekday,
      weekOfMonth: rule.weekOfMonth,
      anchorMonth: rule.anchorMonth,
      nextRun: rule.nextRun,
      isActive: rule.isActive,
      assigneeId: rule.assigneeId,
      assigneeName: rule.assigneeId != null ? (nameById.get(rule.assigneeId) ?? null) : null,
      isBillable: rule.isBillable,
      unitPrice: rule.unitPrice,
      isCustom: rule.isCustom,
      subtasks: subtasks.map((s) => s.title),
      subtaskCount: subtasks.length,
      sopLinkCount: sopRows.filter((l) => l.recurringTaskId === rule.id).length,
      billingQtyThisMonth: rule.isBillable
        ? recurringBillingQuantityForMonth(shape, today.year, today.month)
        : null,
    };
  });
}

// ── Writes ────────────────────────────────────────────────────────────────

async function requireClient(clientId: number): Promise<ClientRow> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new RecurringRuleError(404, `Client ${clientId} not found`);
  return client;
}

async function requireRule(ruleId: number): Promise<RuleRow> {
  const [rule] = await db.select().from(recurringTasks).where(eq(recurringTasks.id, ruleId)).limit(1);
  if (!rule) throw new RecurringRuleError(404, `Recurring rule ${ruleId} not found`);
  return rule;
}

/** §15 trigger: resync billing when the custom-billable-active set may have changed. */
async function resyncBillingIfBillable(clientId: number, touched: boolean, today: LocalDate) {
  if (!touched) return;
  await onClientBillingFieldsChanged(clientId, today);
}

export interface CreateRuleResult {
  ruleId: number;
  clientId: number;
  nextRun: string;
}

export async function createClientRule(
  clientId: number,
  input: RecurringRuleInput,
  userId: number,
  today: LocalDate = localToday(),
): Promise<CreateRuleResult> {
  const client = await requireClient(clientId);
  // §29 pause/project guard - every creation path, with a human reason.
  const blocked = assertGeneratesWork(toDomainClient(client));
  if (blocked) {
    throw new RecurringRuleError(409, `Cannot add a recurring rule: ${blocked}.`);
  }

  const title = input.title.trim();
  if (title === "") throw new RecurringRuleError(400, "The rule needs a title.");
  const schedule = validateSchedule(input);
  const billing = validateBilling(input);
  const subtasks = normalizeSubtasks(input.subtasks);
  const nextRun = formatLocalDate(nextRunFrom(toRuleShape(schedule), floorAnchor(client, today)));

  const existing = await db
    .select({ position: recurringTasks.position })
    .from(recurringTasks)
    .where(eq(recurringTasks.clientId, clientId));
  const position = existing.reduce((max, r) => Math.max(max, r.position + 1), 0);

  const [inserted] = await db
    .insert(recurringTasks)
    .values({
      clientId,
      title,
      description: input.description?.trim() || null,
      ...schedule,
      nextRun,
      isActive: true,
      assigneeId: input.assigneeId ?? null,
      isBillable: billing.isBillable,
      unitPrice: billing.unitPrice,
      // Hand-created through the client tab = a custom rule (§15 custom items).
      isCustom: true,
      position,
    })
    .returning({ id: recurringTasks.id });

  if (subtasks.length > 0) {
    await db.insert(recurringTaskSubtasks).values(
      subtasks.map((subtaskTitle, subtaskPosition) => ({
        recurringTaskId: inserted.id,
        title: subtaskTitle,
        position: subtaskPosition,
      })),
    );
  }

  await logEvent({
    userId,
    action: "recurring_rule_created",
    entityType: "recurring_task",
    entityId: inserted.id,
    metadata: { clientId, title, scheduleType: schedule.scheduleType, nextRun },
  });
  await resyncBillingIfBillable(clientId, billing.isBillable, today);
  return { ruleId: inserted.id, clientId, nextRun };
}

export interface UpdateRuleResult {
  ruleId: number;
  clientId: number;
  cadenceChanged: boolean;
  /** null when the rule was never scheduled and the cadence did not change. */
  nextRun: string | null;
  instancesRetired: number;
}

const SCHEDULE_FIELDS = [
  "scheduleType",
  "daysOfWeek",
  "dayOfMonth",
  "weekday",
  "weekOfMonth",
  "anchorMonth",
] as const;

export async function updateClientRule(
  ruleId: number,
  input: RecurringRuleInput,
  userId: number,
  today: LocalDate = localToday(),
): Promise<UpdateRuleResult> {
  const rule = await requireRule(ruleId);
  const client = await requireClient(rule.clientId);

  const title = input.title.trim();
  if (title === "") throw new RecurringRuleError(400, "The rule needs a title.");
  const schedule = validateSchedule(input);
  const billing = validateBilling(input);
  const subtasks = normalizeSubtasks(input.subtasks);

  const cadenceChanged = SCHEDULE_FIELDS.some((f) => schedule[f] !== rule[f]);

  let nextRun = rule.nextRun;
  let instancesRetired = 0;
  if (cadenceChanged) {
    // New cadence, new first run (catch-up floor per §29), and retire the
    // open instances whose period no longer exists under the new cadence.
    nextRun = formatLocalDate(nextRunFrom(toRuleShape(schedule), floorAnchor(client, today)));
    instancesRetired = await retireOffCadenceInstances(rule.id, schedule, new Date());
  }

  await db
    .update(recurringTasks)
    .set({
      title,
      description: input.description?.trim() || null,
      ...schedule,
      nextRun,
      assigneeId: input.assigneeId ?? null,
      isBillable: billing.isBillable,
      unitPrice: billing.unitPrice,
      updatedAt: new Date(),
    })
    .where(eq(recurringTasks.id, rule.id));

  // Subtask checklist template: replace the set wholesale (titles only).
  await db.delete(recurringTaskSubtasks).where(eq(recurringTaskSubtasks.recurringTaskId, rule.id));
  if (subtasks.length > 0) {
    await db.insert(recurringTaskSubtasks).values(
      subtasks.map((subtaskTitle, subtaskPosition) => ({
        recurringTaskId: rule.id,
        title: subtaskTitle,
        position: subtaskPosition,
      })),
    );
  }

  await logEvent({
    userId,
    action: "recurring_rule_updated",
    entityType: "recurring_task",
    entityId: rule.id,
    metadata: { clientId: rule.clientId, title, cadenceChanged, nextRun, instancesRetired },
  });
  await resyncBillingIfBillable(
    rule.clientId,
    rule.isCustom && (rule.isBillable || billing.isBillable),
    today,
  );
  return { ruleId: rule.id, clientId: rule.clientId, cadenceChanged, nextRun, instancesRetired };
}

export interface SetRuleActiveResult {
  ruleId: number;
  clientId: number;
  isActive: boolean;
  changed: boolean;
}

/**
 * Pause/resume (§6.3): pausing freezes future generation - the generator
 * skips inactive rules - and leaves existing instances untouched. Resuming
 * keeps the stored next_run so the next runRecurringOnce catches the rule up
 * instead of skipping periods; a rule with no next_run gets one computed
 * (catch-up floor applied).
 */
export async function setRuleActive(
  ruleId: number,
  active: boolean,
  userId: number,
  today: LocalDate = localToday(),
): Promise<SetRuleActiveResult> {
  const rule = await requireRule(ruleId);
  if (rule.isActive === active) {
    return { ruleId: rule.id, clientId: rule.clientId, isActive: active, changed: false };
  }

  let nextRun = rule.nextRun;
  if (active && nextRun == null) {
    const client = await requireClient(rule.clientId);
    nextRun = formatLocalDate(
      nextRunFrom(toRuleShape({
        scheduleType: rule.scheduleType,
        daysOfWeek: rule.daysOfWeek,
        dayOfMonth: rule.dayOfMonth,
        weekday: rule.weekday,
        weekOfMonth: rule.weekOfMonth,
        anchorMonth: rule.anchorMonth,
      }), floorAnchor(client, today)),
    );
  }

  await db
    .update(recurringTasks)
    .set({ isActive: active, nextRun, updatedAt: new Date() })
    .where(eq(recurringTasks.id, rule.id));
  await logEvent({
    userId,
    action: active ? "recurring_rule_resumed" : "recurring_rule_paused",
    entityType: "recurring_task",
    entityId: rule.id,
    metadata: { clientId: rule.clientId, title: rule.title },
  });
  await resyncBillingIfBillable(rule.clientId, rule.isCustom && rule.isBillable, today);
  return { ruleId: rule.id, clientId: rule.clientId, isActive: active, changed: true };
}

export type DeleteRuleResult =
  | { deleted: true; clientId: number; instancesRemoved: number }
  | { deleted: false; deactivated: true; clientId: number; message: string };

/**
 * Soft delete (§9 Trash Bin semantics): only a rule with NO completed
 * instances can be removed - its untouched generated instances are
 * soft-deleted (30-day trash) and the rule row is deleted (subtask rows and
 * SOP links cascade). A rule with completed work is deactivated instead and
 * the caller gets a human explanation.
 */
export async function deleteClientRule(
  ruleId: number,
  userId: number,
  today: LocalDate = localToday(),
): Promise<DeleteRuleResult> {
  const rule = await requireRule(ruleId);

  const generated = await db
    .select({ id: tasks.id, status: tasks.status, deletedAt: tasks.deletedAt })
    .from(tasks)
    .where(eq(tasks.recurringTaskId, ruleId));
  const completedCount = generated.filter((t) => t.status === "completed").length;

  if (completedCount > 0) {
    if (rule.isActive) {
      await db
        .update(recurringTasks)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(recurringTasks.id, rule.id));
    }
    await logEvent({
      userId,
      action: "recurring_rule_delete_blocked",
      entityType: "recurring_task",
      entityId: rule.id,
      metadata: { clientId: rule.clientId, title: rule.title, completedCount },
    });
    await resyncBillingIfBillable(rule.clientId, rule.isCustom && rule.isBillable, today);
    return {
      deleted: false,
      deactivated: true,
      clientId: rule.clientId,
      message: `"${rule.title}" has ${completedCount} completed ${
        completedCount === 1 ? "task" : "tasks"
      }, so it was paused instead of deleted. Completed work is never removed.`,
    };
  }

  const now = new Date();
  const open = generated.filter(
    (t) => t.deletedAt == null && !(TOUCHED_TASK_STATUSES as readonly string[]).includes(t.status),
  );
  for (const t of open) {
    await db.update(tasks).set({ deletedAt: now, updatedAt: now }).where(eq(tasks.id, t.id));
  }
  await db.delete(recurringTasks).where(eq(recurringTasks.id, rule.id));
  await logEvent({
    userId,
    action: "recurring_rule_deleted",
    entityType: "recurring_task",
    entityId: rule.id,
    metadata: { clientId: rule.clientId, title: rule.title, instancesRemoved: open.length },
  });
  await resyncBillingIfBillable(rule.clientId, rule.isCustom && rule.isBillable, today);
  return { deleted: true, clientId: rule.clientId, instancesRemoved: open.length };
}
