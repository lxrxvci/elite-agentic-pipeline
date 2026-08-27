import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  addDays,
  commissionPayoutDate,
  commissionRate,
  formatLocalDate,
  invoiceCountsForCommission,
  isOnHold,
  lastDayOfMonth,
  mergedMinutes,
  onTimePercent,
  parseLocalDate,
  semiMonthlyPeriods,
  totalPay,
  type CommissionTier,
  type LocalDate,
  type Month,
  type OnTimeCounts,
  type PayoutConfig,
} from "@firmos/domain";

import { db } from "@/db";
import {
  appSettings,
  clients,
  invoices,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";

import { toDomainClient } from "./domain-adapters";
import { getCommissionFloorRate, getCommissionTiers } from "./pricing-config";
import { collectUserIntervals } from "./time-tracking";

/**
 * Payroll engine (HANDOFF §6.6, §15).
 *
 * Every rule comes from @firmos/domain: the on-time ratio and its null
 * no-data case (onTimePercent), the tier table and override bypass
 * (commissionRate), the semi-monthly calendar (semiMonthlyPeriods), the
 * payout cadence mapping (commissionPayoutDate), the invoice scoping
 * (invoiceCountsForCommission), and the pay total (totalPay). Row
 * SELECTION (the §6.6 exclusions) happens here, never the math.
 *
 * §29 fix by construction: hours come from collectUserIntervals +
 * mergedMinutes (the same wall-clock union the hours report uses), never
 * from summing stored duration_minutes.
 */

export class PayrollError extends Error {
  constructor(
    public readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "PayrollError";
  }
}

const PAYOUT_CONFIG_KEY = "payroll_config";
const DEFAULT_PAYOUT: PayoutConfig = "next_month_first";
const PAYOUT_CONFIGS: readonly PayoutConfig[] = [
  "next_month_first",
  "next_month_second",
  "same_month_second",
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Process-local calendar day (firm-local, §30 conv. 4) -> instant. */
function dayStart(d: LocalDate): Date {
  return new Date(d.year, d.month - 1, d.day);
}

function monthBounds(year: number, month: number): { start: string; end: string } {
  return {
    start: formatLocalDate({ year, month, day: 1 }),
    end: formatLocalDate({ year, month, day: lastDayOfMonth(year, month) }),
  };
}

/** A row completed any time on its due date counts as on time. */
function completedOnTime(completedAt: Date | null, dueDate: string): boolean {
  if (!completedAt) return false;
  const nextDay = dayStart(addDays(parseLocalDate(dueDate), 1));
  return completedAt.getTime() < nextDay.getTime();
}

// ── On-time percentage (§6.6) ─────────────────────────────────────────────

export interface OnTimeResult {
  userId: number;
  year: number;
  month: number;
  /** null = the no-data case (domain onTimePercent). */
  onTimePercent: number | null;
  counts: OnTimeCounts;
}

/**
 * §6.6: (tasks on time + feeds on time) / (tasks due + feeds due).
 *
 * Exclusions, applied at row selection per the spec:
 *  - cancelled tasks (status 'cancelled');
 *  - waiting-on-client work (task status 'waiting_on_client', feed
 *    waiting_on_client flag);
 *  - catch-up-dated work (feed due_date floored to the client's
 *    bank_feed_catchup_date; tasks carry no catch-up date concept);
 *  - rows for on-hold clients (paused or inactive - domain isOnHold);
 *  - soft-deleted tasks.
 *
 * "Due" means due_date inside the month on or before `today`; rows due
 * later in the month are not yet scorable.
 */
export async function getOnTimePercentage(
  userId: number,
  year: number,
  month: number,
  today: LocalDate,
): Promise<OnTimeResult> {
  const bounds = monthBounds(year, month);
  const todayStr = formatLocalDate(today);
  const dueCeiling = bounds.end < todayStr ? bounds.end : todayStr;

  const clientRows = await db.select().from(clients);
  const clientById = new Map(clientRows.map((c) => [c.id, c]));

  const counts: OnTimeCounts = { tasksOnTime: 0, feedsOnTime: 0, tasksDue: 0, feedsDue: 0 };

  // Tasks: the assignee's own work items due in the scoring window.
  const taskRows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.assigneeId, userId),
        isNull(tasks.deletedAt),
        isNotNull(tasks.dueDate),
      ),
    );
  for (const task of taskRows) {
    const due = task.dueDate!;
    if (due < bounds.start || due > dueCeiling) continue;
    if (task.status === "cancelled" || task.status === "waiting_on_client") continue;
    const client = task.clientId != null ? clientById.get(task.clientId) : undefined;
    if (client && isOnHold(toDomainClient(client))) continue;
    counts.tasksDue += 1;
    if (task.status === "completed" && completedOnTime(task.completedAt, due)) {
      counts.tasksOnTime += 1;
    }
  }

  // Bank feeds: the client's bookkeeper owns the feed score.
  const feedRows = await db
    .select()
    .from(weeklyBankFeeds)
    .where(isNotNull(weeklyBankFeeds.dueDate));
  for (const feed of feedRows) {
    const client = clientById.get(feed.clientId);
    if (!client || client.bookkeeperId !== userId) continue;
    if (isOnHold(toDomainClient(client))) continue;
    if (feed.waitingOnClient) continue;
    const due = feed.dueDate!;
    if (due < bounds.start || due > dueCeiling) continue;
    // Catch-up-dated rows: due date floored to the client's catch-up date.
    if (client.bankFeedCatchupDate != null && due === client.bankFeedCatchupDate) continue;
    counts.feedsDue += 1;
    if (feed.isCompleted && completedOnTime(feed.completedAt, due)) {
      counts.feedsOnTime += 1;
    }
  }

  return {
    userId,
    year,
    month,
    onTimePercent: onTimePercent(counts),
    counts,
  };
}

// ── Payout config (§6.6 "configurable in Admin → Payroll") ───────────────

export interface PayrollConfig {
  commission_payout: PayoutConfig;
}

export async function getPayoutConfig(): Promise<PayrollConfig> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, PAYOUT_CONFIG_KEY))
    .limit(1);
  const value = row?.value as Partial<PayrollConfig> | undefined;
  const cadence = value?.commission_payout;
  return {
    commission_payout: PAYOUT_CONFIGS.includes(cadence as PayoutConfig)
      ? (cadence as PayoutConfig)
      : DEFAULT_PAYOUT,
  };
}

/** Admin/owner only - the role check lives in the server action. */
export async function setPayoutConfig(
  config: PayrollConfig,
  actorId: number,
): Promise<PayrollConfig> {
  if (!PAYOUT_CONFIGS.includes(config.commission_payout)) {
    throw new PayrollError(400, `Unknown payout cadence: ${config.commission_payout}`);
  }
  await db
    .insert(appSettings)
    .values({
      key: PAYOUT_CONFIG_KEY,
      value: { commission_payout: config.commission_payout },
      updatedById: actorId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value: { commission_payout: config.commission_payout },
        updatedById: actorId,
        updatedAt: new Date(),
      },
    });
  return config;
}

// ── Commission report (§6.6) ──────────────────────────────────────────────

export interface CommissionRow {
  userId: number;
  userName: string;
  onTimePercent: number | null;
  /** Tier rate, or the per-user commission_rate_override when set (§15). */
  rate: number;
  usedOverride: boolean;
  /** Sum of invoice totals sent or paid in the month for active clients. */
  commissionBase: number;
  commissionAmount: number;
  invoiceIds: number[];
}

export interface CommissionReport {
  year: number;
  month: number;
  rows: CommissionRow[];
}

async function commissionForUser(
  user: typeof users.$inferSelect,
  year: number,
  month: number,
  today: LocalDate,
  tiers: readonly CommissionTier[],
  floorRate: number,
): Promise<CommissionRow> {
  const m: Month = { year, month };
  const onTime = await getOnTimePercentage(user.id, year, month, today);
  const override =
    user.commissionRateOverride != null ? Number(user.commissionRateOverride) : null;
  // Admin-configured tier table + floor (pricing-config); HANDOFF defaults when unset.
  const rate = commissionRate(onTime.onTimePercent, override, tiers, floorRate);

  // §6.6: commission applies to invoices sent or paid in the month for the
  // bookkeeper's active (not on hold) clients - domain owns the predicate.
  const clientRows = await db
    .select()
    .from(clients)
    .where(eq(clients.bookkeeperId, user.id));
  const activeClientIds = new Set(
    clientRows.filter((c) => !isOnHold(toDomainClient(c))).map((c) => c.id),
  );

  const invoiceRows = await db
    .select()
    .from(invoices)
    .where(inArray(invoices.status, ["sent", "paid"]));
  let commissionBase = 0;
  const invoiceIds: number[] = [];
  for (const inv of invoiceRows) {
    if (!activeClientIds.has(inv.clientId)) continue;
    const counts = invoiceCountsForCommission(
      {
        status: inv.status,
        sent_at: inv.sentAt?.toISOString() ?? null,
        paid_at: inv.paidAt?.toISOString() ?? null,
      },
      m,
    );
    if (!counts) continue;
    commissionBase += Number(inv.total ?? 0);
    invoiceIds.push(inv.id);
  }

  return {
    userId: user.id,
    userName: `${user.firstName} ${user.lastName}`,
    onTimePercent: onTime.onTimePercent,
    rate,
    usedOverride: override != null,
    commissionBase: round2(commissionBase),
    commissionAmount: round2((commissionBase * rate) / 100),
    invoiceIds,
  };
}

export async function getCommissionReport(
  year: number,
  month: number,
  today: LocalDate,
): Promise<CommissionReport> {
  const tiers = await getCommissionTiers();
  const floorRate = await getCommissionFloorRate();
  const bookkeepers = await db
    .select()
    .from(users)
    .where(and(eq(users.role, "bookkeeper"), eq(users.isActive, true)));
  const rows: CommissionRow[] = [];
  for (const user of bookkeepers) {
    rows.push(await commissionForUser(user, year, month, today, tiers, floorRate));
  }
  return { year, month, rows };
}

// ── Payroll calculator (§15) ──────────────────────────────────────────────

export interface PayrollPeriodRow {
  key: "first" | "second";
  start: string;
  end: string;
  payDate: string;
  /** §29: wall-clock union hours, never a raw duration sum. */
  hours: number;
  hourlyPay: number;
}

export interface PayrollUserRow {
  userId: number;
  userName: string;
  role: string;
  baseHourlyPay: number;
  periods: PayrollPeriodRow[];
  totalHours: number;
  hourlyTotal: number;
  commission: {
    onTimePercent: number | null;
    rate: number;
    base: number;
    amount: number;
    payoutDate: string;
  } | null;
  totalPay: number;
}

export interface PayrollCalculator {
  year: number;
  month: number;
  payoutConfig: PayrollConfig;
  rows: PayrollUserRow[];
}

export async function getPayrollCalculator(
  year: number,
  month: number,
  today: LocalDate,
): Promise<PayrollCalculator> {
  const config = await getPayoutConfig();
  const tiers = await getCommissionTiers();
  const floorRate = await getCommissionFloorRate();
  const periods = semiMonthlyPeriods(year, month);
  const m: Month = { year, month };
  const commissionDate = commissionPayoutDate(config.commission_payout, m);

  const staff = await db
    .select()
    .from(users)
    .where(
      and(inArray(users.role, ["owner", "admin", "manager", "bookkeeper"]), eq(users.isActive, true)),
    );

  const rows: PayrollUserRow[] = [];
  for (const user of staff) {
    const baseHourlyPay = user.baseHourlyPay != null ? Number(user.baseHourlyPay) : 0;

    const periodRows: PayrollPeriodRow[] = [];
    let totalHours = 0;
    let hourlyTotal = 0;
    for (const period of periods) {
      const from = dayStart(period.start);
      // Clamp the window to now for in-progress periods: an open timer must
      // not accrue hours into the future (read at this entry point only).
      const to = new Date(
        Math.min(dayStart(addDays(period.end, 1)).getTime(), Date.now()),
      );
      const collected = await collectUserIntervals(user.id, from, to);
      const minutes = mergedMinutes([
        ...collected.day,
        ...collected.activities.map((a) => a.interval),
        ...collected.taskTimers.map((t) => t.interval),
      ]);
      const hours = round2(minutes / 60);
      const hourlyPay = round2(hours * baseHourlyPay);
      totalHours = round2(totalHours + hours);
      hourlyTotal = round2(hourlyTotal + hourlyPay);
      periodRows.push({
        key: period.key,
        start: formatLocalDate(period.start),
        end: formatLocalDate(period.end),
        payDate: formatLocalDate(period.payDate),
        hours,
        hourlyPay,
      });
    }

    let commission: PayrollUserRow["commission"] = null;
    let commissionAmount = 0;
    if (user.role === "bookkeeper") {
      const c = await commissionForUser(user, year, month, today, tiers, floorRate);
      commissionAmount = c.commissionAmount;
      commission = {
        onTimePercent: c.onTimePercent,
        rate: c.rate,
        base: c.commissionBase,
        amount: c.commissionAmount,
        payoutDate: formatLocalDate(commissionDate),
      };
    }

    rows.push({
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      role: user.role,
      baseHourlyPay,
      periods: periodRows,
      totalHours,
      hourlyTotal,
      commission,
      // §15: total pay = union hours x base_hourly_pay + commission.
      totalPay: round2(totalPay(totalHours, baseHourlyPay, commissionAmount)),
    });
  }

  return { year, month, payoutConfig: config, rows };
}

// ── CSV export ────────────────────────────────────────────────────────────

function csvCell(value: string | number | null): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per user per semi-monthly period, plus a monthly total row. */
export function payrollCalculatorCsv(calc: PayrollCalculator): string {
  const header = [
    "user_id",
    "user_name",
    "role",
    "period",
    "period_start",
    "period_end",
    "pay_date",
    "hours",
    "base_hourly_pay",
    "hourly_pay",
    "commission_rate",
    "commission_base",
    "commission_amount",
    "commission_payout_date",
    "total_pay",
  ];
  const lines = [header.join(",")];
  for (const row of calc.rows) {
    for (const period of row.periods) {
      lines.push(
        [
          row.userId,
          csvCell(row.userName),
          row.role,
          period.key,
          period.start,
          period.end,
          period.payDate,
          period.hours.toFixed(2),
          row.baseHourlyPay.toFixed(2),
          period.hourlyPay.toFixed(2),
          "",
          "",
          "",
          "",
          "",
        ].join(","),
      );
    }
    lines.push(
      [
        row.userId,
        csvCell(row.userName),
        row.role,
        "month_total",
        "",
        "",
        "",
        row.totalHours.toFixed(2),
        row.baseHourlyPay.toFixed(2),
        row.hourlyTotal.toFixed(2),
        row.commission?.rate ?? "",
        row.commission?.base.toFixed(2) ?? "",
        row.commission?.amount.toFixed(2) ?? "",
        row.commission?.payoutDate ?? "",
        row.totalPay.toFixed(2),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}
