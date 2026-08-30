import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import {
  categoryCompletion,
  clientHealthScore,
  clientWorkState,
  compareLocalDate,
  countsForScoring,
  formatLocalDate,
  parseLocalDate,
  reportMonthsForFrequency,
  type ClientWorkState,
  type HealthRow,
  type HealthStatus,
  type LocalDate,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  clientReports,
  clients,
  contactClientLinks,
  contacts,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";

import { requireRole, requireStaff } from "./auth/guards";
import { catchupOf, toDomainClient, type ClientRow } from "./domain-adapters";
import { localToday } from "./dates";
import { getFirmProfitability } from "./profitability";
import { aggregateStreamCells, closeStreak, type ProgressionCell } from "./progression";
import { getUnifiedQueue, type WorkCard } from "./queue";
import {
  YEAR_GRID_STREAMS,
  buildStreamRow,
  feedToGridRow,
  reconToGridRow,
  reportToGridRow,
  taskToGridRow,
  type GridWorkRow,
  type YearGridStream,
} from "./year-grid";

/**
 * Clients surface reads (staff-only). Every function guards with
 * requireStaff/requireRole at the top - the guards throw a typed AuthError
 * and are the ONLY authorization decision point (HANDOFF §11).
 *
 * Health and lifecycle verdicts come from @firmos/domain (clientWorkState,
 * clientHealthScore, isHealthCountable, categoryCompletion) with the same
 * exclusion rules the work engine uses: waiting-on-client rows, deferred
 * feeds, and pre-catch-up periods never count toward a health category
 * (HANDOFF §21), and on-hold clients (paused/inactive) are never scored at
 * all (countsForScoring, §6.2).
 */

export interface StaffRef {
  id: number;
  name: string;
  initials: string;
}

export interface ClientHealthSummary {
  score: number;
  status: HealthStatus;
}

export interface ClientListRow {
  id: number;
  legalName: string;
  dbaName: string | null;
  state: ClientWorkState;
  bookkeepingFrequency: string;
  /** pgEnum text '5' | '10' | '15', or null when the cadence has no close tier. */
  monthlyCloseTier: string | null;
  isRealEstateClient: boolean;
  manager: StaffRef | null;
  bookkeeper: StaffRef | null;
  /** Open work rows across all four kinds; 0 for on-hold clients (frozen). */
  openWorkCount: number;
  /** Consecutive closed periods this year (shared closeStreak engine); 0 for
   *  on-hold clients. Rendered as a pill when >= 3. */
  closeStreak: number;
  /** null for on-hold clients - pausing must never punish the score (§5). */
  health: ClientHealthSummary | null;
  /**
   * Month-to-date effective $/hr (recurring / paced union hours), populated
   * only when the requester is admin/owner - billing content never enters
   * the payload for other roles (§10). null = no hours this month.
   */
  effectiveHourlyRate?: number | null;
}

export interface ClientList {
  today: string;
  rows: ClientListRow[];
}

interface UserNameRow {
  id: number;
  firstName: string;
  lastName: string;
}

function refOf(row: UserNameRow | undefined): StaffRef | null {
  if (!row) return null;
  return {
    id: row.id,
    name: `${row.firstName} ${row.lastName}`,
    initials: `${row.firstName[0] ?? ""}${row.lastName[0] ?? ""}`.toUpperCase(),
  };
}

export { refOf as staffRefOf };

/** The raw work rows a health summary is scored from (all states, not just open). */
export interface HealthSourceRows {
  feeds: {
    completedAt: Date | null;
    dueDate: string | null;
    waitingOnClient: boolean;
    deferredUntil: string | null;
  }[];
  recons: { completedAt: Date | null; dueDate: string | null; waitingOnClient: boolean }[];
  reports: { completedAt: Date | null; dueDate: string | null }[];
  openTasks: { status: string; dueDate: string | null }[];
}

/**
 * The §21 health summary for one client: categories are bank feeds,
 * reconciliations, and reports (waiting-on-client rows, deferred feeds, and
 * pre-catch-up periods never count toward a category), plus the overdue
 * non-category task penalty. Returns null for on-hold clients - pausing
 * must never punish the score (§5). Shared by the clients list and the
 * progression board so the ring can never disagree between surfaces.
 */
export function healthSummaryFromRows(
  client: ClientRow,
  rows: HealthSourceRows,
  today: LocalDate,
): ClientHealthSummary | null {
  if (!countsForScoring(toDomainClient(client))) return null;

  const catchup = catchupOf(client);
  const toHealthRow = (r: {
    completedAt: Date | null;
    dueDate: string | null;
    waitingOnClient?: boolean;
    deferredUntil?: string | null;
  }): HealthRow => ({
    completed: r.completedAt != null,
    due_date: r.dueDate ? parseLocalDate(r.dueDate) : null,
    waiting_on_client: r.waitingOnClient ?? false,
    deferred_until: r.deferredUntil ? parseLocalDate(r.deferredUntil) : null,
  });

  const categories = [
    { name: "bank_feeds", rows: rows.feeds.map(toHealthRow), opts: { catchupDate: catchup ?? undefined } },
    { name: "reconciliations", rows: rows.recons.map(toHealthRow), opts: {} },
    { name: "reports", rows: rows.reports.map(toHealthRow), opts: {} },
  ].map((cat) => {
    const completion = categoryCompletion(cat.rows, cat.opts);
    return { name: cat.name, applicable: completion != null, completion: completion ?? 0 };
  });

  const overdueTaskCount = rows.openTasks.filter(
    (t) =>
      t.status !== "waiting_on_client" &&
      t.dueDate != null &&
      compareLocalDate(parseLocalDate(t.dueDate), today) < 0,
  ).length;

  return clientHealthScore(categories, overdueTaskCount);
}

/**
 * Close streak for the /clients row marker: the SAME helpers the Progress
 * board uses (year-grid stream scoring -> aggregateStreamCells ->
 * closeStreak), computed from the already-batched rows so the list adds no
 * per-client queries. Streaks only span the current year.
 */
function closeStreakForClient(
  client: ClientRow,
  rows: {
    feeds: (typeof weeklyBankFeeds.$inferSelect)[];
    recons: (typeof accountReconciliations.$inferSelect)[];
    reports: (typeof clientReports.$inferSelect)[];
    tasks: (typeof tasks.$inferSelect)[];
  },
  year: number,
  today: LocalDate,
): number {
  const cadenceMonths = reportMonthsForFrequency(client.bookkeepingFrequency);
  const rowsByStream: Record<YearGridStream, GridWorkRow[]> = {
    bank_feeds: [],
    reconciliations: [],
    reports: [],
    tasks: [],
  };
  for (const r of rows.feeds) {
    const row = feedToGridRow(r);
    if (row.period.year === year) rowsByStream.bank_feeds.push(row);
  }
  for (const r of rows.recons) {
    if (r.attributedYear === year) rowsByStream.reconciliations.push(reconToGridRow(r));
  }
  for (const r of rows.reports) {
    if (r.attributedYear === year) rowsByStream.reports.push(reportToGridRow(r));
  }
  for (const t of rows.tasks) {
    const row = taskToGridRow(t, today);
    if (row.period.year === year) rowsByStream.tasks.push(row);
  }
  const streamRows = YEAR_GRID_STREAMS.map((stream) =>
    buildStreamRow(stream, rowsByStream[stream], cadenceMonths, year, today),
  );
  const cells: ProgressionCell[] = cadenceMonths.map((month, i) => ({
    month,
    onCadence: true,
    state: aggregateStreamCells(streamRows.map((r) => r.cells[i])),
    streams: [],
  }));
  return closeStreak(cells);
}

/**
 * The /clients list: every client with staff, lifecycle state, open-work
 * counts, and a domain-computed health summary. Six batched queries total -
 * no per-client round-trips.
 */
export async function listClients(): Promise<ClientList> {
  const user = await requireStaff();
  const today = localToday();

  const [clientRows, userRows, feedRows, reconRows, reportRows, taskRows] = await Promise.all([
    db.select().from(clients).orderBy(asc(clients.legalName)),
    db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users),
    db.select().from(weeklyBankFeeds),
    db.select().from(accountReconciliations),
    db.select().from(clientReports),
    // Completed rows ride along for the close-streak read; open counts and
    // health filter them back out in memory.
    db
      .select()
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), notInArray(tasks.status, ["cancelled"]))),
  ]);

  const userById = new Map(userRows.map((u) => [u.id, u]));

  // Group open work rows by client once, then count and score per client.
  const feedsByClient = new Map<number, typeof feedRows>();
  const reconsByClient = new Map<number, typeof reconRows>();
  const reportsByClient = new Map<number, typeof reportRows>();
  const tasksByClient = new Map<number, typeof taskRows>();
  for (const r of feedRows) feedsByClient.set(r.clientId, [...(feedsByClient.get(r.clientId) ?? []), r]);
  for (const r of reconRows) reconsByClient.set(r.clientId, [...(reconsByClient.get(r.clientId) ?? []), r]);
  for (const r of reportRows) reportsByClient.set(r.clientId, [...(reportsByClient.get(r.clientId) ?? []), r]);
  for (const t of taskRows) {
    if (t.clientId != null) tasksByClient.set(t.clientId, [...(tasksByClient.get(t.clientId) ?? []), t]);
  }

  const rows: ClientListRow[] = clientRows.map((c) => {
    const domain = toDomainClient(c);
    const state = clientWorkState(domain);
    const scored = countsForScoring(domain);

    const allFeeds = feedsByClient.get(c.id) ?? [];
    const allRecons = reconsByClient.get(c.id) ?? [];
    const allReports = reportsByClient.get(c.id) ?? [];
    const allTasks = tasksByClient.get(c.id) ?? [];
    const openTasks = allTasks.filter((t) => t.status !== "completed");

    const feeds = allFeeds.filter((r) => r.completedAt == null);
    const recons = allRecons.filter((r) => r.completedAt == null);
    const reports = allReports.filter((r) => r.completedAt == null);

    const openWorkCount = scored ? feeds.length + recons.length + reports.length + openTasks.length : 0;
    const health = healthSummaryFromRows(
      c,
      { feeds: allFeeds, recons: allRecons, reports: allReports, openTasks },
      today,
    );
    const streak = scored
      ? closeStreakForClient(
          c,
          { feeds: allFeeds, recons: allRecons, reports: allReports, tasks: allTasks },
          today.year,
          today,
        )
      : 0;

    return {
      id: c.id,
      legalName: c.legalName,
      dbaName: c.dbaName,
      state,
      bookkeepingFrequency: c.bookkeepingFrequency,
      monthlyCloseTier: c.monthlyCloseTier,
      isRealEstateClient: c.isRealEstateClient,
      manager: c.managerId != null ? refOf(userById.get(c.managerId)) : null,
      bookkeeper: c.bookkeeperId != null ? refOf(userById.get(c.bookkeeperId)) : null,
      openWorkCount,
      closeStreak: streak,
      health,
    };
  });

  // Admin/owner only: attach the month-to-date effective rate per client.
  // One batched engine pass - no per-client queries - and the money figure
  // is never selected into the payload for other roles.
  if (user.normalizedRole === "admin" || user.normalizedRole === "owner") {
    const monthStart = new Date(today.year, today.month - 1, 1);
    const firm = await getFirmProfitability(monthStart, new Date());
    const rateByClient = new Map(firm.rows.map((r) => [r.clientId, r.effectiveHourlyRate]));
    for (const row of rows) {
      row.effectiveHourlyRate = rateByClient.get(row.id) ?? null;
    }
  }

  return { today: formatLocalDate(today), rows };
}

// ── Client detail ───────────────────────────────────────────────────

export interface ClientContactRow {
  linkId: number;
  contactId: number;
  name: string;
  email: string | null;
  phone: string | null;
  relationshipType: string;
  ownershipPercent: string | null;
  isPrimary: boolean;
  isCpa: boolean;
}

export interface ClientAccountRow {
  id: number;
  name: string;
  accountType: string;
  institution: string | null;
  statementDay: number | null;
  isActive: boolean;
}

export interface OnboardingChecklistRow {
  id: number;
  title: string;
  status: string;
  assignee: StaffRef | null;
  dueDate: string | null;
  completedAt: string | null;
}

export interface ClientDetail {
  id: number;
  legalName: string;
  dbaName: string | null;
  state: ClientWorkState;
  taxStructure: string | null;
  accountingMethod: string | null;
  businessAddress: string | null;
  businessCity: string | null;
  businessState: string | null;
  businessZip: string | null;
  bookkeepingFrequency: string;
  billingFrequency: string;
  monthlyCloseTier: string | null;
  bookkeepingStartDate: string | null;
  bankFeedCatchupDate: string | null;
  /** The client's assigned work day (0 = Sunday … 6 = Saturday); null = unassigned. */
  workDayOfWeek?: number | null;
  isRealEstateClient: boolean;
  isProjectEngagement: boolean;
  projectCutoffDate: string | null;
  qboClassNames: string[];
  qboLocationNames: string[];
  /** Intake-stamped QBO facts (§15 pass-through); null when never captured. */
  qboUserCount: number | null;
  qboSubscriptionTier: string | null;
  manager: StaffRef | null;
  bookkeeper: StaffRef | null;
  contacts: ClientContactRow[];
  owners: ClientContactRow[];
  accounts: ClientAccountRow[];
  onboarding: OnboardingChecklistRow[];
}

export async function getClientDetail(id: number): Promise<ClientDetail | null> {
  await requireStaff();

  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) return null;

  const staffIds = [client.managerId, client.bookkeeperId].filter((v): v is number => v != null);
  const [staffRows, linkRows, accountRows, onboardingRows] = await Promise.all([
    staffIds.length > 0
      ? db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
      : Promise.resolve([]),
    db
      .select({ link: contactClientLinks, contact: contacts })
      .from(contactClientLinks)
      .innerJoin(contacts, eq(contacts.id, contactClientLinks.contactId))
      .where(eq(contactClientLinks.clientId, id)),
    db.select().from(accounts).where(eq(accounts.clientId, id)).orderBy(asc(accounts.name)),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, id), eq(tasks.taskType, "onboarding"), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.id)),
  ]);

  const staffById = new Map(staffRows.map((u) => [u.id, u]));
  const assigneeIds = [
    ...new Set(onboardingRows.map((t) => t.assigneeId).filter((v): v is number => v != null)),
  ];
  const assigneeRows =
    assigneeIds.length > 0
      ? await db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
      : [];
  for (const u of assigneeRows) if (!staffById.has(u.id)) staffById.set(u.id, u);

  const contactName = (c: typeof contacts.$inferSelect): string =>
    c.type === "entity"
      ? (c.entityName ?? "Unnamed entity")
      : [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed contact";

  const contactRows: ClientContactRow[] = linkRows.map(({ link, contact }) => ({
    linkId: link.id,
    contactId: contact.id,
    name: contactName(contact),
    email: contact.email,
    phone: contact.phone,
    relationshipType: link.relationshipType,
    ownershipPercent: link.ownershipPercent,
    isPrimary: client.primaryContactId === contact.id,
    isCpa: client.cpaContactId === contact.id,
  }));

  return {
    id: client.id,
    legalName: client.legalName,
    dbaName: client.dbaName,
    state: clientWorkState(toDomainClient(client)),
    taxStructure: client.taxStructure,
    accountingMethod: client.accountingMethod,
    businessAddress: client.businessAddress,
    businessCity: client.businessCity,
    businessState: client.businessState,
    businessZip: client.businessZip,
    bookkeepingFrequency: client.bookkeepingFrequency,
    billingFrequency: client.billingFrequency,
    monthlyCloseTier: client.monthlyCloseTier,
    bookkeepingStartDate: client.bookkeepingStartDate,
    bankFeedCatchupDate: client.bankFeedCatchupDate,
    workDayOfWeek: client.workDayOfWeek,
    isRealEstateClient: client.isRealEstateClient,
    isProjectEngagement: client.isProjectEngagement,
    projectCutoffDate: client.projectCutoffDate,
    qboClassNames: client.qboClassNames ?? [],
    qboLocationNames: client.qboLocationNames ?? [],
    qboUserCount: client.qboUserCount,
    qboSubscriptionTier: client.qboSubscriptionTier,
    manager: client.managerId != null ? refOf(staffById.get(client.managerId)) : null,
    bookkeeper: client.bookkeeperId != null ? refOf(staffById.get(client.bookkeeperId)) : null,
    contacts: contactRows,
    owners: contactRows.filter((c) => c.relationshipType === "owner"),
    accounts: accountRows.map((a) => ({
      id: a.id,
      name: a.name,
      accountType: a.accountType,
      institution: a.institution,
      statementDay: a.statementDay,
      isActive: a.isActive,
    })),
    onboarding: onboardingRows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignee: t.assigneeId != null ? refOf(staffById.get(t.assigneeId)) : null,
      dueDate: t.dueDate,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    })),
  };
}

// ── Client work tab ─────────────────────────────────────────────────

const PERIODIC_KINDS = new Set(["bank_feed", "reconciliation", "report"]);

export interface ClientWork {
  today: string;
  /** Domain lifecycle state drives the explanatory empty states. */
  state: ClientWorkState;
  isProjectEngagement: boolean;
  rows: WorkCard[];
}

/**
 * Open work for one client, bucketed by the SAME unified-queue engine the
 * Workstation uses (identical attribution, gating, and aging). Visibility
 * rule (HANDOFF §10): project-engagement clients never see periodic rows
 * (bank feeds, reconciliations, reports) - the filter is enforced here,
 * server-side, so periodic work never reaches the client component.
 */
export async function getClientWork(id: number): Promise<ClientWork | null> {
  const user = await requireStaff();
  const [client] = await db
    .select({
      id: clients.id,
      isActive: clients.isActive,
      isPaused: clients.isPaused,
      isProjectEngagement: clients.isProjectEngagement,
    })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  if (!client) return null;

  const state = clientWorkState({
    is_active: client.isActive,
    is_paused: client.isPaused,
    is_project_engagement: client.isProjectEngagement,
  });
  const queue = await getUnifiedQueue(user.id);
  const rows = Object.values(queue.buckets)
    .flat()
    .filter((card) => card.clientId === id)
    .filter((card) => !(client.isProjectEngagement && PERIODIC_KINDS.has(card.kind)));

  return { today: queue.today, state, isProjectEngagement: client.isProjectEngagement, rows };
}

// ── Client billing tab (admin/owner only) ───────────────────────────

export interface BillingTemplateLine {
  serviceKey: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  frequency: string;
  notes: string | null;
  manualEdit: boolean;
  /** Line total renormalized to a per-month amount (§6.5 cadence rule). */
  monthlyAmount: number;
}

export interface ClientBilling {
  lines: BillingTemplateLine[];
  monthlyTotal: number;
  monthlyRecurringAmount: string | null;
  baseMonthlyAmount: string | null;
  perAccountPrice: string | null;
  billingFrequency: string;
  isAutoPay: boolean;
  billingLastSyncedAt: string | null;
}

/** Template frequency -> fraction of a month the line bills at (§6.5). */
const FREQUENCY_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semi_annual: 6,
  annual: 12,
  weekly: 12 / 52,
  daily: 1 / 30,
};

interface RawTemplateLine {
  service_key?: unknown;
  product_name?: unknown;
  unit_price?: unknown;
  quantity?: unknown;
  discount?: unknown;
  frequency?: unknown;
  notes?: unknown;
  manual_edit?: unknown;
}

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Services template line items + cached billing amounts. Guarded to
 * admin/owner at the read itself (HANDOFF §10) - billing content is never
 * selected for other roles, so it can never leak into a page payload.
 */
export async function getClientBilling(id: number): Promise<ClientBilling | null> {
  await requireRole("owner", "admin");

  const [client] = await db
    .select({
      recurringServicesTemplate: clients.recurringServicesTemplate,
      monthlyRecurringAmount: clients.monthlyRecurringAmount,
      baseMonthlyAmount: clients.baseMonthlyAmount,
      perAccountPrice: clients.perAccountPrice,
      billingFrequency: clients.billingFrequency,
      isAutoPay: clients.isAutoPay,
      billingLastSyncedAt: clients.billingLastSyncedAt,
    })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  if (!client) return null;

  const raw = Array.isArray(client.recurringServicesTemplate)
    ? (client.recurringServicesTemplate as RawTemplateLine[])
    : [];

  const lines: BillingTemplateLine[] = raw
    .filter((l) => typeof l === "object" && l !== null && l.service_key !== "__section_discount__")
    .map((l) => {
      const unitPrice = toNumber(l.unit_price);
      const quantity = toNumber(l.quantity, 1);
      const discount = toNumber(l.discount);
      const frequency = typeof l.frequency === "string" ? l.frequency : "monthly";
      const months = FREQUENCY_MONTHS[frequency] ?? 1;
      const monthlyAmount = (unitPrice * quantity - discount) / months;
      return {
        serviceKey: typeof l.service_key === "string" ? l.service_key : "custom",
        productName: typeof l.product_name === "string" ? l.product_name : "Custom item",
        unitPrice,
        quantity,
        discount,
        frequency,
        notes: typeof l.notes === "string" ? l.notes : null,
        manualEdit: l.manual_edit === true,
        monthlyAmount,
      };
    });

  const monthlyTotal = lines.reduce((sum, l) => sum + l.monthlyAmount, 0);

  return {
    lines,
    monthlyTotal,
    monthlyRecurringAmount: client.monthlyRecurringAmount,
    baseMonthlyAmount: client.baseMonthlyAmount,
    perAccountPrice: client.perAccountPrice,
    billingFrequency: client.billingFrequency,
    isAutoPay: client.isAutoPay,
    billingLastSyncedAt: client.billingLastSyncedAt ? client.billingLastSyncedAt.toISOString() : null,
  };
}
