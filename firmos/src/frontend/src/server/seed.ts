import path from "node:path";
import url from "node:url";

import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  addDays,
  addMonths,
  formatLocalDate,
  type LocalDate,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  authAccounts,
  authVerifications,
  clientIntakes,
  clientReports,
  clients,
  clientUserAccess,
  contactClientLinks,
  contacts,
  documents,
  intakeOwners,
  invoices,
  onboardingTemplateTasks,
  properties,
  propertyProformas,
  recurringTasks,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";

import { localToday } from "./dates";
import { materializeOperationalRows } from "./materialize";
import { runRecurringOnce } from "./recurring";
import { resyncAllBilling } from "./billing-sync";

/**
 * Idempotent dev seed modeling HANDOFF §26's adversarial world: seven
 * personas across six clients chosen to exercise every work-engine rule:
 *
 *  (a) Harborline Marine Supply - monthly close tier 5, three accounts with
 *      mixed statement days (month-end 31, mid-month 20, pre-cutoff 3),
 *      weekly bank feeds with a catch-up date, plus a daily rule and a
 *      custom quarterly rule.
 *  (b) Blue Spruce Landscaping - monthly tier 15, one waiting-on-client
 *      feed and one deferred feed.
 *  (c) Copperline Coffee Roasters - quarterly cadence with anchor_month.
 *  (d) Northwind Frame & Door - annual cadence.
 *  (e) Redwood Pediatric Therapy - PAUSED; rules seeded with past next_run
 *      must stay frozen (§6.3) until unpaused.
 *  (f) Summit Peak Builders - project engagement; no recurring work at all.
 *  (g) Riverstone Property Group - REAL ESTATE (§20): two properties (Maple
 *      Court Duplex with a mortgage, Cedar Street Fourplex sold), one
 *      staff-entered pro forma, and Alison linked as a portal user so the
 *      portal Properties surface has a live client. Harborline also carries
 *      paid/sent/draft invoices so the portal Invoices list has rows.
 *
 * The seed is delete-then-insert per table in FK order, then runs both
 * generators (materialize + recurring) so the unified queue has real rows.
 *
 * DEV CREDENTIALS (ADR-0005): every seeded user signs in with password
 * `Firm0s-dev!`. Credential accounts live in Better Auth's `account` table,
 * hashed with Better Auth's own hashPassword so login actually works. TOTP
 * MFA is disabled for all seeded users (dev convenience) - enable it per
 * user at /account/security. Users:
 *   mara@blueledgerbooks.com   owner       jorge@blueledgerbooks.com  bookkeeper
 *   theo@blueledgerbooks.com   admin       sofia@blueledgerbooks.com  bookkeeper
 *   dana@blueledgerbooks.com   manager     alison@harborlinemarine.com client
 *   priya@blueledgerbooks.com  manager     carlos@riverstonetax.com    cpa
 *
 * Portal linkage (§12): alison's contact has ContactClientLinks to
 * Harborline (a, owner) and Blue Spruce (b, primary_contact), with
 * ClientUserAccess rows that VARY the capability flags so enforcement is
 * testable - (a) can_upload_docs=true/can_view_tasks=true, (b) both false.
 * Carlos is the cpa_contact for Harborline (a, monthly) and Copperline
 * (c, quarterly); his ClientUserAccess rows keep can_upload_docs false,
 * matching the §12 rule that CPA upload is forced off.
 */

export interface SeedSummary {
  today: string;
  users: number;
  clients: number;
  accounts: number;
  intakes: number;
  onboardingTemplateTasks: number;
  recurringRules: number;
  tasks: number;
  weeklyBankFeeds: number;
  accountReconciliations: number;
  clientReports: number;
}

/** Dev-only password for every seeded user - see the header comment. */
export const SEED_PASSWORD = "Firm0s-dev!";

type ClientInsert = typeof clients.$inferInsert;
type RuleInsert = typeof recurringTasks.$inferInsert;

async function wipe(): Promise<void> {
  // Truncate every public table with CASCADE: hand-ordered deletes broke
  // whenever a new user-referencing table appeared (time tracking, audit
  // events, notifications). The drizzle migrations table lives in the
  // "drizzle" schema, so pg_tables in "public" is exactly our app schema.
  const rows = (await db.execute(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  )) as unknown as { tablename: string }[];
  const tables = rows.map((r) => r.tablename);
  if (tables.length === 0) return;
  await db.execute(
    sql.raw(`truncate table ${tables.map((t) => `"${t}"`).join(", ")} restart identity cascade`),
  );
}

export async function seedDatabase(today: LocalDate = localToday()): Promise<SeedSummary> {
  await wipe();

  const yearStart = `${today.year}-01-01`;
  const catchup = formatLocalDate({ ...addMonths({ year: today.year, month: today.month }, -2), day: 1 });

  // ── Users (§26 seven personas + §12 CPA portal persona) ──
  const [contact] = await db
    .insert(contacts)
    .values({
      type: "individual",
      firstName: "Alison",
      lastName: "Brewer",
      email: "alison@harborlinemarine.com",
    })
    .returning();
  const [cpaContact] = await db
    .insert(contacts)
    .values({
      type: "individual",
      firstName: "Carlos",
      lastName: "Reyes",
      email: "carlos@riverstonetax.com",
    })
    .returning();

  const staff = [
    { email: "mara@blueledgerbooks.com", firstName: "Mara", lastName: "Ellison", role: "owner" as const },
    { email: "theo@blueledgerbooks.com", firstName: "Theo", lastName: "Park", role: "admin" as const },
    { email: "dana@blueledgerbooks.com", firstName: "Dana", lastName: "Whitfield", role: "manager" as const },
    { email: "priya@blueledgerbooks.com", firstName: "Priya", lastName: "Raman", role: "manager" as const },
    { email: "jorge@blueledgerbooks.com", firstName: "Jorge", lastName: "Medina", role: "bookkeeper" as const },
    { email: "sofia@blueledgerbooks.com", firstName: "Sofia", lastName: "Lindqvist", role: "bookkeeper" as const },
  ];
  // One shared scrypt hash keeps the seed fast; every user gets the same
  // dev password. Better Auth verifies against account.password, so the
  // legacy users.password_hash column just stores the same hash for parity.
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const insertedUsers = await db
    .insert(users)
    .values([
      ...staff.map((u) => ({ ...u, passwordHash })),
      {
        email: "alison@harborlinemarine.com",
        firstName: "Alison",
        lastName: "Brewer",
        role: "client" as const,
        contactId: contact.id,
        passwordHash,
      },
      {
        email: "carlos@riverstonetax.com",
        firstName: "Carlos",
        lastName: "Reyes",
        role: "cpa" as const,
        contactId: cpaContact.id,
        passwordHash,
      },
    ])
    .returning();

  // Better Auth credential accounts - this is what sign-in actually checks.
  // BA 1.7 keys accounts by (issuer, accountId); passwords use the synthetic
  // "local:credential" issuer.
  await db.insert(authAccounts).values(
    insertedUsers.map((u) => ({
      issuer: "local:credential",
      accountId: String(u.id),
      providerId: "credential",
      userId: u.id,
      password: passwordHash,
    })),
  );
  const byEmail = new Map(insertedUsers.map((u) => [u.email, u.id]));
  const managerDana = byEmail.get("dana@blueledgerbooks.com")!;
  const managerPriya = byEmail.get("priya@blueledgerbooks.com")!;
  const bookkeeperJorge = byEmail.get("jorge@blueledgerbooks.com")!;
  const bookkeeperSofia = byEmail.get("sofia@blueledgerbooks.com")!;

  // §21 - bookkeepers report to managers (hours-report scoping).
  await db.update(users).set({ managerId: managerDana }).where(eq(users.id, bookkeeperJorge));
  await db.update(users).set({ managerId: managerPriya }).where(eq(users.id, bookkeeperSofia));

  // ── Clients ──
  // Work days (owner call notes: "my Monday clients"): Harborline Monday,
  // Blue Spruce Tuesday, Copperline Thursday, Riverstone Friday; Northwind,
  // Redwood (paused) and Summit Peak (project) stay unassigned.
  const clientSpecs: (ClientInsert & { key: string })[] = [
    {
      key: "a",
      legalName: "Harborline Marine Supply",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "5",
      requiresWeeklyBankFeeds: true,
      bankFeedDayOfWeek: 5,
      bankFeedCatchupDate: catchup,
      bookkeepingStartDate: yearStart,
      workDayOfWeek: 1,
      managerId: managerDana,
      bookkeeperId: bookkeeperJorge,
      cpaContactId: cpaContact.id,
    },
    {
      key: "b",
      legalName: "Blue Spruce Landscaping",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      requiresWeeklyBankFeeds: true,
      bankFeedDayOfWeek: 5,
      bookkeepingStartDate: yearStart,
      workDayOfWeek: 2,
      managerId: managerDana,
      bookkeeperId: bookkeeperSofia,
    },
    {
      key: "c",
      legalName: "Copperline Coffee Roasters",
      bookkeepingFrequency: "quarterly",
      requiresWeeklyBankFeeds: false,
      bookkeepingStartDate: yearStart,
      workDayOfWeek: 4,
      managerId: managerPriya,
      bookkeeperId: bookkeeperJorge,
      cpaContactId: cpaContact.id,
    },
    {
      key: "d",
      legalName: "Northwind Frame & Door",
      bookkeepingFrequency: "annual",
      requiresWeeklyBankFeeds: false,
      bookkeepingStartDate: yearStart,
      managerId: managerPriya,
      bookkeeperId: bookkeeperSofia,
    },
    {
      key: "e",
      legalName: "Redwood Pediatric Therapy",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      requiresWeeklyBankFeeds: true,
      bookkeepingStartDate: yearStart,
      isPaused: true,
      pausedAt: new Date(),
      managerId: managerDana,
      bookkeeperId: bookkeeperJorge,
    },
    {
      key: "f",
      legalName: "Summit Peak Builders",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      requiresWeeklyBankFeeds: false,
      isProjectEngagement: true,
      bookkeepingStartDate: yearStart,
      managerId: managerPriya,
      bookkeeperId: bookkeeperSofia,
    },
    {
      key: "g",
      legalName: "Riverstone Property Group",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      requiresWeeklyBankFeeds: false,
      isRealEstateClient: true,
      bookkeepingStartDate: yearStart,
      workDayOfWeek: 5,
      managerId: managerPriya,
      bookkeeperId: bookkeeperSofia,
    },
  ];
  const insertedClients = await db
    .insert(clients)
    .values(clientSpecs.map(({ key: _key, ...c }) => c))
    .returning();
  const clientIdByKey = new Map(clientSpecs.map((s, i) => [s.key, insertedClients[i].id]));
  const cid = (key: string) => clientIdByKey.get(key)!;

  // ── Portal linkage (§12) ──
  // Alison sees Harborline and Blue Spruce through ContactClientLinks; the
  // CPA's clients come from clients.cpa_contact_id (set on a + c above).
  await db.insert(contactClientLinks).values([
    { contactId: contact.id, clientId: cid("a"), relationshipType: "owner" },
    { contactId: contact.id, clientId: cid("b"), relationshipType: "primary_contact" },
    // (g) real-estate client - Alison is the portal persona for it too.
    { contactId: contact.id, clientId: cid("g"), relationshipType: "owner" },
  ]);
  // ClientUserAccess with deliberately VARIED flags so capability
  // enforcement is testable (§29: all three flags enforced by construction).
  const alisonId = byEmail.get("alison@harborlinemarine.com")!;
  const carlosId = byEmail.get("carlos@riverstonetax.com")!;
  await db.insert(clientUserAccess).values([
    { userId: alisonId, clientId: cid("a"), canUploadDocs: true, canViewTasks: true, canMessage: true },
    { userId: alisonId, clientId: cid("b"), canUploadDocs: false, canViewTasks: false, canMessage: true },
    { userId: alisonId, clientId: cid("g"), canUploadDocs: true, canViewTasks: true, canMessage: true },
    { userId: carlosId, clientId: cid("a"), canUploadDocs: false, canViewTasks: true, canMessage: true },
    { userId: carlosId, clientId: cid("c"), canUploadDocs: false, canViewTasks: true, canMessage: true },
  ]);

  // ── Accounts ──
  const insertedAccounts = await db
    .insert(accounts)
    .values([
      // (a) mixed statement days: month-end, mid-month, pre-cutoff.
      { clientId: cid("a"), name: "Operating Checking", accountType: "checking", statementDay: 31, openDate: yearStart },
      { clientId: cid("a"), name: "Business Credit Card", accountType: "credit_card", statementDay: 20, openDate: yearStart },
      { clientId: cid("a"), name: "Payroll Checking", accountType: "checking", statementDay: 3, openDate: yearStart },
      { clientId: cid("b"), name: "Main Checking", accountType: "checking", statementDay: 31, openDate: yearStart },
      { clientId: cid("b"), name: "Amex Gold", accountType: "credit_card", statementDay: 8, openDate: yearStart },
      { clientId: cid("c"), name: "Operating", accountType: "checking", statementDay: 31, openDate: yearStart },
      { clientId: cid("d"), name: "Checking", accountType: "checking", statementDay: 31, openDate: yearStart },
      // Owner-documented: no statement day → excluded from reconciliations.
      { clientId: cid("d"), name: "Owner Draws", accountType: "owner_distributions", statementDay: null, openDate: yearStart },
      { clientId: cid("e"), name: "Clinic Checking", accountType: "checking", statementDay: 31, openDate: yearStart },
      { clientId: cid("f"), name: "Project Checking", accountType: "checking", statementDay: 31, openDate: yearStart },
    ])
    .returning();

  // ── (g) Real-estate properties (§20) ──
  // Inserted BEFORE resyncAllBilling so the mortgage on Maple Court bills
  // through loans_and_liabilities from the start (§15 live-state rebuild).
  const [mapleCourt, cedarStreet] = await db
    .insert(properties)
    .values([
      {
        clientId: cid("g"),
        name: "Maple Court Duplex",
        propertyType: "Duplex",
        addressLine1: "412 Maple Ct",
        city: "Portland",
        state: "OR",
        zip: "97211",
        purchasePrice: "485000",
        purchaseDate: "2023-04-14",
        annualRevenue: "39600",
        annualExpenses: "14200",
        mortgageLender: "Columbia Bank",
        mortgageBalance: "312450.00",
        monthlyMortgagePayment: "2180.00",
        qboClassName: "Maple Court",
        depreciation: {
          land_value: { value: 120000, known: true },
          building_value: { value: 365000, known: true },
          improvements: { value: 8500, known: false },
          furniture_fixtures: { value: null, known: false },
          other: { value: null, known: false },
        },
      },
      {
        clientId: cid("g"),
        name: "Cedar Street Fourplex",
        propertyType: "Fourplex",
        addressLine1: "88 Cedar St",
        city: "Portland",
        state: "OR",
        zip: "97215",
        isSold: true,
        soldDate: formatLocalDate(addDays(today, -60)),
        salePrice: "710000",
        purchasePrice: "540000",
        purchaseDate: "2019-09-30",
        annualRevenue: "58200",
        annualExpenses: "21500",
        qboClassName: "Cedar Street",
      },
    ])
    .returning();

  // One staff-entered pro forma for next year so the §20 grid shows a
  // staff-entered cell beside the missing ones (portal submits the rest).
  await db.insert(propertyProformas).values({
    propertyId: mapleCourt.id,
    year: today.year + 1,
    figures: { rental_income: 40800, property_taxes: 5100, insurance: 1800 },
    lastEditedById: bookkeeperSofia,
    lastEditedAt: new Date(),
    fromPortal: false,
  });
  void cedarStreet;

  // ── Invoices (§15) - portal Invoices list reads non-draft rows (§12) ──
  // Harborline gets one paid, one sent, and one draft (the draft proves the
  // portal filter); Riverstone gets one overdue so its portal list has a row.
  // All rows are manual (is_auto_generated=false) so monthly invoice
  // generation never treats them as existing period rows (§6.5 skip rule),
  // and their periods sit in Mar-May - months the invoices test suite never
  // generates - so they cannot shadow a generated invoice either.
  const invoicePeriod = (offset: number) => addMonths({ year: today.year, month: today.month }, offset);
  const p1 = invoicePeriod(-4);
  const p2 = invoicePeriod(-5);
  const p3 = invoicePeriod(-3);
  await db.insert(invoices).values([
    {
      clientId: cid("a"),
      invoiceNumber: `INV-${today.year}-0001`,
      status: "paid",
      year: p1.year,
      month: p1.month,
      isAutoGenerated: false,
      issueDate: formatLocalDate({ ...p1, day: 1 }),
      dueDate: formatLocalDate({ ...p1, day: 16 }),
      total: "485.00",
      sentAt: new Date(),
      paidAt: new Date(),
    },
    {
      clientId: cid("a"),
      invoiceNumber: `INV-${today.year}-0002`,
      status: "sent",
      year: p3.year,
      month: p3.month,
      isAutoGenerated: false,
      issueDate: formatLocalDate({ ...p3, day: 1 }),
      dueDate: formatLocalDate({ ...p3, day: 16 }),
      total: "485.00",
      sentAt: new Date(),
    },
    {
      clientId: cid("a"),
      status: "draft",
      year: p2.year,
      month: p2.month,
      isAutoGenerated: false,
      total: "320.00",
    },
    {
      clientId: cid("g"),
      invoiceNumber: `INV-${today.year}-0003`,
      status: "overdue",
      year: p1.year,
      month: p1.month,
      isAutoGenerated: false,
      issueDate: formatLocalDate({ ...p1, day: 1 }),
      dueDate: formatLocalDate({ ...p1, day: 16 }),
      total: "640.00",
      sentAt: new Date(),
    },
  ]);

  // ── Onboarding template tasks (§19/§22; conversion materializes them) ──
  // Admin-phase tasks start new on the client; the rest start blocked until
  // the admin phase completes.
  const onboardingTemplateSpecs = [
    { title: "Send welcome packet and engagement letter", isAdminPhase: true, defaultAssigneeRole: "manager", position: 0 },
    { title: "Collect signed engagement letter and W-9", isAdminPhase: true, defaultAssigneeRole: "manager", position: 1 },
    { title: "Gather prior-year financials and tax returns", isAdminPhase: true, defaultAssigneeRole: "manager", position: 2 },
    { title: "Set up or verify QuickBooks Online access", isAdminPhase: false, defaultAssigneeRole: "bookkeeper", position: 3 },
    { title: "Connect bank feeds for all accounts", isAdminPhase: false, defaultAssigneeRole: "bookkeeper", position: 4 },
    { title: "Import and review chart of accounts", isAdminPhase: false, defaultAssigneeRole: "bookkeeper", position: 5 },
    { title: "Confirm reporting cadence and close tier", isAdminPhase: false, defaultAssigneeRole: "manager", position: 6 },
    { title: "Walk through the first monthly close with the client", isAdminPhase: false, defaultAssigneeRole: "manager", position: 7 },
  ];
  const insertedOnboardingTemplates = await db
    .insert(onboardingTemplateTasks)
    .values(onboardingTemplateSpecs)
    .returning();

  // ── Intakes with wizard payloads in form_data (drive client_reports) ──
  const intakeSpecs = [
    {
      key: "a",
      reportDefinitions: [
        { name: "Monthly Financial Package", frequency: "monthly" },
        { name: "Quarterly Tax Summary", frequency: "quarterly" },
      ],
    },
    { key: "b", reportDefinitions: [{ name: "Monthly Financial Package", frequency: "monthly" }] },
    { key: "c", reportDefinitions: [{ name: "Quarterly Financial Package", frequency: "quarterly" }] },
    { key: "d", reportDefinitions: [{ name: "Annual Financial Package", frequency: "annual" }] },
    { key: "e", reportDefinitions: [{ name: "Monthly Financial Package", frequency: "monthly" }] },
    { key: "f", reportDefinitions: [{ name: "Monthly Financial Package", frequency: "monthly" }] },
    { key: "g", reportDefinitions: [{ name: "Monthly Financial Package", frequency: "monthly" }] },
  ];
  await db.insert(clientIntakes).values(
    intakeSpecs.map((s) => ({
      status: "completed" as const,
      legalName: clientSpecs.find((c) => c.key === s.key)!.legalName,
      clientId: cid(s.key),
      bookkeepingStartDate: yearStart,
      managerId: managerDana,
      bookkeeperId: bookkeeperJorge,
      convertedAt: new Date(),
      reportDefinitions: s.reportDefinitions,
      formData: {
        serviceKeys: ["bank_feed_management", "account_reconciliations", "monthly_reporting_15"],
        owners: [{ name: "Jordan Reyes", email: "jordan@example.com", ownershipPercent: 100 }],
        contacts: [
          { firstName: "Jordan", lastName: "Reyes", email: "jordan@example.com", isPrimary: true },
        ],
        accounts: [
          { name: "Operating Checking", accountType: "checking" },
          { name: "Business Credit Card", accountType: "credit_card" },
        ],
        reportDefinitions: s.reportDefinitions,
      },
    })),
  );

  // ── One nearly-complete intake awaiting review (§6.8 purgatory) ──
  // Carries the full seven-step wizard payload: services, owners, contacts,
  // accounts (including a multi-merchant pair and an owner-documented loan),
  // report definitions, and a custom recurring rule.
  const reviewFormData = {
    serviceKeys: [
      "bank_feed_management",
      "account_reconciliations",
      "merchant_account_reconciliation",
      "loans_and_liabilities",
      "monthly_reporting_10",
      "class_tracking",
      "1099_collection",
      "1099_per_filing",
    ],
    owners: [
      { name: "Wren Okafor", email: "wren@fernfeather.shop", ownershipPercent: 60 },
      { name: "Sal Vega", email: "sal@fernfeather.shop", ownershipPercent: 40 },
    ],
    contacts: [
      { firstName: "Wren", lastName: "Okafor", email: "wren@fernfeather.shop", phone: "503-555-0182", isPrimary: true },
      { entityName: "Cascade Tax Group", email: "team@cascadetax.example", relationshipType: "cpa" },
    ],
    referralSource: "CPA referral",
    engagementType: "bookkeeping",
    quickbooksStatus: "existing",
    needsQuickbooksSetup: false,
    accounts: [
      { name: "Operating Checking", accountType: "checking", institution: "Columbia Bank" },
      { name: "Savings", accountType: "savings", institution: "Columbia Bank" },
      { name: "Business Credit Card", accountType: "credit_card", institution: "Amex" },
      { name: "Delivery Van Loan", accountType: "vehicle_loan", institution: "Columbia Bank" },
      { name: "Loan from Wren", accountType: "loans_from_shareholders" },
    ],
    merchantAccounts: [
      { name: "Stripe", processor: "Stripe" },
      { name: "Square", processor: "Square" },
    ],
    payrollFrequency: "biweekly",
    payrollProvider: "Gusto",
    reportDefinitions: [
      { name: "Monthly Financial Package", frequency: "monthly" },
      { name: "Quarterly Tax Summary", frequency: "quarterly" },
    ],
    estimated1099Count: 4,
    include1099Collection: true,
    includeMerchantReconciliation: true,
    qboClassNames: ["Retail", "Wholesale"],
    customRecurringRules: [
      {
        title: "Weekly deposit review",
        scheduleType: "weekly",
        daysOfWeek: "1",
        subtasks: ["Pull deposit report", "Match to merchant payouts"],
      },
    ],
    internalNotes: "Referred by Cascade Tax Group. Wants close by the 10th.",
  };
  const [reviewIntake] = await db
    .insert(clientIntakes)
    .values({
      status: "pending_review" as const,
      legalName: "Fern & Feather Floral Studio",
      dbaName: "Fern & Feather",
      taxStructure: "LLC",
      taxId: "93-4821765",
      industry: "Retail florist",
      referralSource: "CPA referral",
      businessAddress: "1418 NE Floral Ave",
      businessCity: "Portland",
      businessState: "OR",
      businessZip: "97232",
      engagementType: "bookkeeping",
      quickbooksStatus: "existing",
      bookkeepingFrequency: "monthly",
      billingFrequency: "monthly",
      monthlyCloseTier: "10",
      accountingMethod: "accrual",
      payrollProvider: "Gusto",
      bookkeepingStartDate: yearStart,
      managerId: managerDana,
      bookkeeperId: bookkeeperSofia,
      reportDefinitions: reviewFormData.reportDefinitions,
      customRecurringRules: reviewFormData.customRecurringRules,
      formData: reviewFormData,
      internalNotes: reviewFormData.internalNotes,
      submittedAt: new Date(),
    })
    .returning();
  await db.insert(intakeOwners).values(
    reviewFormData.owners.map((o) => ({
      intakeId: reviewIntake.id,
      name: o.name,
      email: o.email,
      ownershipPercent: String(o.ownershipPercent),
    })),
  );

  // ── Recurring rules ──
  // The four defaults, cadence-aware per §19 (schedule follows the client's
  // bookkeeping_frequency; quarterly/annual pin anchor_month). Tier day is
  // the due day for close-work rules on monthly clients.
  const defaults = (
    clientKey: string,
    scheduleType: RuleInsert["scheduleType"],
    dayOfMonth: number,
    anchorMonth: number | null,
  ): RuleInsert[] => {
    const manager = clientKey === "a" || clientKey === "b" || clientKey === "e" ? managerDana : managerPriya;
    const bookkeeper = clientKey === "a" || clientKey === "c" || clientKey === "e" ? bookkeeperJorge : bookkeeperSofia;
    const base = {
      clientId: cid(clientKey),
      scheduleType,
      anchorMonth,
      nextRun: `${today.year}-01-${String(Math.min(dayOfMonth, 28)).padStart(2, "0")}`,
    };
    return [
      { ...base, title: "Categorize Transactions", dayOfMonth, assigneeId: bookkeeper },
      { ...base, title: "Reconcile Accounts", dayOfMonth, assigneeId: bookkeeper },
      { ...base, title: "Client Questions", dayOfMonth: 25, assigneeId: manager },
      { ...base, title: "Send Reports", dayOfMonth, assigneeId: manager },
    ];
  };

  const ruleSpecs: RuleInsert[] = [
    ...defaults("a", "monthly", 5, null),
    // (a) daily rule - past next_run exercises daily catch-up consolidation.
    {
      clientId: cid("a"),
      title: "Review cash position",
      scheduleType: "daily",
      nextRun: formatLocalDate(addDays(today, -45)),
      assigneeId: bookkeeperJorge,
    },
    // (a) custom quarterly rule with anchor_month (Feb/May/Aug/Nov cadence).
    {
      clientId: cid("a"),
      title: "Quarterly payroll review",
      scheduleType: "quarterly",
      dayOfMonth: 15,
      anchorMonth: 2,
      nextRun: `${today.year}-02-15`,
      assigneeId: managerDana,
      isCustom: true,
    },
    ...defaults("b", "monthly", 15, null),
    ...defaults("c", "quarterly", 15, 1),
    ...defaults("d", "annual", 15, 1),
    ...defaults("e", "monthly", 10, null), // paused - must stay frozen
    // (f) project engagement: no rules at all (§19 skips project clients).
    ...defaults("g", "monthly", 10, null),
  ];
  const insertedRules = await db.insert(recurringTasks).values(ruleSpecs).returning();

  // ── Billing templates from live state (§6.5 price flow, §15 resync) ──
  // Converted clients carry a recurring services template built from the
  // quote; the seed's direct-insert clients get the equivalent by running
  // the live-state resync, so invoice generation has real templates to bill.
  await resyncAllBilling(today);

  // ── Run both generators so the queue has real rows ──
  await materializeOperationalRows(today);
  await runRecurringOnce(today);

  // ── (b) one waiting-on-client feed and one deferred feed ──
  const bFeeds = await db
    .select()
    .from(weeklyBankFeeds)
    .where(
      and(
        eq(weeklyBankFeeds.clientId, cid("b")),
        eq(weeklyBankFeeds.attributedYear, today.year),
        eq(weeklyBankFeeds.attributedMonth, today.month),
      ),
    );
  if (bFeeds[0]) {
    await db
      .update(weeklyBankFeeds)
      .set({ waitingOnClient: true, clientNote: "Waiting on July bank statements from the client." })
      .where(eq(weeklyBankFeeds.id, bFeeds[0].id));
  }
  if (bFeeds[1]) {
    await db
      .update(weeklyBankFeeds)
      .set({ deferredUntil: formatLocalDate(addDays(today, 14)) })
      .where(eq(weeklyBankFeeds.id, bFeeds[1].id));
  }

  // ── Completed billable ad-hoc work (§6.5 pending-billable queue) ──
  // A few converted clients get completed, still-uninvoiced billable tasks
  // so the pending queue and monthly invoice generation have real pickup
  // data. Ad-hoc tasks carry no unit price (tasks has no unit_price column);
  // they invoice at 0.00 until staff edits the draft line.
  const priorMonth = addMonths({ year: today.year, month: today.month }, -1);
  const twoMonthsAgo = addMonths({ year: today.year, month: today.month }, -2);
  await db.insert(tasks).values([
    {
      clientId: cid("a"),
      title: "Catch-up: categorize backlog of owner expenses",
      taskType: "ad_hoc",
      status: "completed",
      billableStatus: "billable",
      dueDate: formatLocalDate({ ...priorMonth, day: 20 }),
      attributedYear: priorMonth.year,
      attributedMonth: priorMonth.month,
      assigneeId: bookkeeperJorge,
      completedAt: new Date(),
      completedById: bookkeeperJorge,
    },
    {
      clientId: cid("a"),
      title: "Reconstruct missing April deposit detail",
      taskType: "ad_hoc",
      status: "completed",
      billableStatus: "billable",
      dueDate: formatLocalDate({ ...twoMonthsAgo, day: 24 }),
      attributedYear: twoMonthsAgo.year,
      attributedMonth: twoMonthsAgo.month,
      assigneeId: bookkeeperJorge,
      completedAt: new Date(),
      completedById: bookkeeperJorge,
    },
    {
      clientId: cid("b"),
      title: "One-off cleanup of duplicate vendor bills",
      taskType: "ad_hoc",
      status: "completed",
      billableStatus: "billable",
      dueDate: formatLocalDate({ ...priorMonth, day: 18 }),
      attributedYear: priorMonth.year,
      attributedMonth: priorMonth.month,
      assigneeId: bookkeeperSofia,
      completedAt: new Date(),
      completedById: bookkeeperSofia,
    },
    {
      clientId: cid("c"),
      title: "Prepare sales tax workpapers for the quarter",
      taskType: "ad_hoc",
      status: "completed",
      billableStatus: "billable",
      dueDate: formatLocalDate({ ...priorMonth, day: 28 }),
      attributedYear: priorMonth.year,
      attributedMonth: priorMonth.month,
      assigneeId: bookkeeperJorge,
      completedAt: new Date(),
      completedById: bookkeeperJorge,
    },
  ]);

  const feedCount = await db.select({ id: weeklyBankFeeds.id }).from(weeklyBankFeeds);
  const taskCount = await db.select({ id: tasks.id }).from(tasks);
  const reconCount = await db.select({ id: accountReconciliations.id }).from(accountReconciliations);
  const reportCount = await db.select({ id: clientReports.id }).from(clientReports);

  return {
    today: formatLocalDate(today),
    users: insertedUsers.length,
    clients: insertedClients.length,
    accounts: insertedAccounts.length,
    intakes: intakeSpecs.length + 1,
    onboardingTemplateTasks: insertedOnboardingTemplates.length,
    recurringRules: insertedRules.length,
    tasks: taskCount.length,
    weeklyBankFeeds: feedCount.length,
    accountReconciliations: reconCount.length,
    clientReports: reportCount.length,
  };
}

// CLI entry: npx tsx src/server/seed.ts
const isMain = process.argv[1]
  ? import.meta.url === url.pathToFileURL(path.resolve(process.argv[1])).href
  : false;
if (isMain) {
  seedDatabase()
    .then((summary) => {
      console.log("seed complete:", JSON.stringify(summary, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("seed failed:", err);
      process.exit(1);
    });
}
