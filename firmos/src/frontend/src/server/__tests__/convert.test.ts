import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  accounts,
  clientCredentials,
  clientIntakes,
  clientManualEntries,
  clientReports,
  clients,
  contactClientLinks,
  contacts,
  institutions,
  merchantProcessors,
  properties,
  recurringTasks,
  recurringTaskSopLinks,
  recurringTaskSubtasks,
  tasks,
  users,
} from "@/db/schema";
import { cascadeIntakeToClient } from "@/server/cascade";
import { ConversionError, convertIntakeToClient, PERSONAL_CARD_REMINDER_TITLE } from "@/server/convert";
import {
  createIntake,
  getIntake,
  submitIntakeForReview,
  updateIntake,
  type IntakePatch,
} from "@/server/intake";
import { calculateIntakeQuote } from "@/server/quote";
import { getUnifiedQueue } from "@/server/queue";
import { seedDatabase } from "@/server/seed";
import { createSopTemplate, listOnboardingTemplates } from "@/server/templates";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

let managerDana: number;
let managerPriya: number;
let bookkeeperJorge: number;
let bookkeeperSofia: number;

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row.id;
}

/** Create + submit an intake ready for conversion. */
async function reviewableIntake(patch: IntakePatch): Promise<number> {
  const row = await createIntake(patch);
  await updateIntake(row.id, {});
  await submitIntakeForReview(row.id);
  return row.id;
}

describe.skipIf(!reachable)("convertIntakeToClient + cascade", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    managerDana = await userIdByEmail("dana@blueledgerbooks.com");
    managerPriya = await userIdByEmail("priya@blueledgerbooks.com");
    bookkeeperJorge = await userIdByEmail("jorge@blueledgerbooks.com");
    bookkeeperSofia = await userIdByEmail("sofia@blueledgerbooks.com");
  });

  it("converts the seeded pending_review intake into the full graph in one transaction", async () => {
    const [intake] = await db
      .select()
      .from(clientIntakes)
      .where(eq(clientIntakes.legalName, "Fern & Feather Floral Studio"))
      .limit(1);
    expect(intake.status).toBe("pending_review");

    const form = intake.formData as Parameters<typeof calculateIntakeQuote>[0];
    const expectedQuote = calculateIntakeQuote(
      {
        ...form,
        bookkeepingFrequency: intake.bookkeepingFrequency,
      },
      TEST_TODAY,
    );

    const result = await convertIntakeToClient(
      intake.id,
      { managerId: managerDana, bookkeeperId: bookkeeperSofia },
      managerDana,
      TEST_TODAY,
    );

    // Client record.
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.legalName).toBe("Fern & Feather Floral Studio");
    expect(client.managerId).toBe(managerDana);
    expect(client.bookkeeperId).toBe(bookkeeperSofia);
    expect(client.monthlyCloseTier).toBe("10");
    expect(client.isProjectEngagement).toBe(false);
    // I6: the intake's payroll provider (Gusto, form_data + column) rides
    // onto the client next to the has_payroll stamp.
    expect(client.payrollProvider).toBe("Gusto");

    // Billing template with amounts straight from the PRICING table.
    const template = client.recurringServicesTemplate as {
      service_key: string;
      unit_price: number;
      quantity: number;
    }[];
    expect(template.length).toBe(expectedQuote.lines.length);
    expect(Number(client.monthlyRecurringAmount)).toBeCloseTo(
      expectedQuote.totals.effectiveMonthly,
      2,
    );
    const reconLine = template.find((l) => l.service_key === "account_reconciliations");
    // Billable: checking + savings + credit card = 3. The vehicle loan is a
    // loan type and the shareholder loan is owner-documented; both merchant
    // accounts are excluded (§6.5 per-account exclusion).
    expect(reconLine?.quantity).toBe(3);
    expect(Number(client.perAccountPrice)).toBe(25);
    const classLine = template.find((l) => l.service_key === "class_tracking");
    expect(classLine?.quantity).toBe(2); // Retail + Wholesale

    // Contacts and links: 2 owners + primary + CPA; owner percents carried.
    const links = await db
      .select()
      .from(contactClientLinks)
      .where(eq(contactClientLinks.clientId, client.id));
    expect(links).toHaveLength(4);
    const ownerLinks = links.filter((l) => l.relationshipType === "owner");
    expect(ownerLinks).toHaveLength(2);
    expect(ownerLinks.map((l) => Number(l.ownershipPercent)).sort((a, b) => a - b)).toEqual([40, 60]);
    expect(client.primaryContactId).not.toBeNull();
    expect(client.cpaContactId).not.toBeNull();
    const [primary] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, client.primaryContactId!));
    expect(primary.email).toBe("wren@fernfeather.shop");

    // Accounts: 5 intake + 2 merchant (never collapsed, §29) + 2 default seeds.
    const clientAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.clientId, client.id));
    expect(clientAccounts).toHaveLength(9);
    const byName = new Map(clientAccounts.map((a) => [a.name, a]));
    expect(byName.get("Operating Checking")?.statementDay).toBe(31);
    expect(byName.get("Delivery Van Loan")?.statementDay).toBe(31);
    expect(byName.get("Loan from Wren")?.statementDay).toBeNull();
    expect(byName.get("Owner Contributions")?.statementDay).toBeNull();
    expect(byName.get("Owner Distributions")?.statementDay).toBeNull();
    // Multi-merchant survives as two rows (§29).
    expect(clientAccounts.filter((a) => a.accountType === "merchant")).toHaveLength(2);
    expect(byName.get("Stripe")?.institution).toBe("Stripe");

    // I3: proof categories stamp from the account data - statement-proof
    // bank/cc/loan rows, owner-declared for the shareholder loan and the
    // seeded equity accounts (and merchant rows stay statement-proof).
    expect(byName.get("Operating Checking")?.proofCategory).toBe("statement");
    expect(byName.get("Savings")?.proofCategory).toBe("statement");
    expect(byName.get("Business Credit Card")?.proofCategory).toBe("statement");
    expect(byName.get("Delivery Van Loan")?.proofCategory).toBe("statement");
    expect(byName.get("Loan from Wren")?.proofCategory).toBe("owner_declared");
    expect(byName.get("Owner Contributions")?.proofCategory).toBe("owner_declared");
    expect(byName.get("Owner Distributions")?.proofCategory).toBe("owner_declared");
    expect(byName.get("Stripe")?.proofCategory).toBe("statement");

    // Recurring rules: 4 defaults (monthly, tier day 10) + 1 custom weekly
    // + 1 merchant reconciliation (I6: the merchant-recon yes answer seeds
    // the monthly task) + 2 specialty report rules (C10: each report
    // definition recurs as its own rule on the report's cadence).
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, client.id));
    expect(rules).toHaveLength(8);
    const titles = rules.map((r) => r.title);
    for (const t of ["Reconcile Accounts", "Categorize Transactions", "Client Questions", "Send Reports"]) {
      expect(titles).toContain(t);
    }
    // I6: the merchant-recon answer seeds the monthly merchant
    // reconciliation task on the close cadence.
    const merchantRule = rules.find((r) => r.title === "Merchant reconciliation");
    expect(merchantRule?.scheduleType).toBe("monthly");
    expect(merchantRule?.dayOfMonth).toBe(10); // the client's tier day
    expect(merchantRule?.assigneeId).toBe(bookkeeperSofia);
    // C10: the two report definitions became recurring rules at their own
    // cadence, carrying the data-source note slot (null here).
    const monthlyReportRule = rules.find((r) => r.title === "Monthly Financial Package");
    expect(monthlyReportRule?.scheduleType).toBe("monthly");
    const quarterlyReportRule = rules.find((r) => r.title === "Quarterly Tax Summary");
    expect(quarterlyReportRule?.scheduleType).toBe("quarterly");
    const custom = rules.find((r) => r.title === "Weekly deposit review");
    expect(custom?.isCustom).toBe(true);
    expect(custom?.scheduleType).toBe("weekly");
    const subtasks = await db
      .select()
      .from(recurringTaskSubtasks)
      .where(eq(recurringTaskSubtasks.recurringTaskId, custom!.id));
    expect(subtasks).toHaveLength(2);

    // Current-year task instances from runRecurringOnce (post-commit).
    const clientTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, client.id), eq(tasks.taskType, "recurring")));
    expect(clientTasks.length).toBeGreaterThanOrEqual(8);
    const periods = new Set(clientTasks.map((t) => `${t.attributedYear}-${t.attributedMonth}`));
    expect(periods.size).toBeGreaterThanOrEqual(6);

    // Onboarding tasks: 9 seeded template rows; admin phase starts new,
    // the rest blocked (§19). A46: the vault-fill task is one of the four
    // admin-phase rows (3B seeded the expectation slots; this prompts them).
    const onboarding = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, client.id), eq(tasks.taskType, "onboarding")));
    expect(onboarding).toHaveLength(9);
    expect(onboarding.filter((t) => t.status === "new")).toHaveLength(4);
    expect(onboarding.filter((t) => t.status === "blocked")).toHaveLength(5);
    const vaultFill = onboarding.find((t) => t.title === "Fill in login credentials in the secure vault");
    expect(vaultFill).toBeDefined();
    expect(vaultFill?.status).toBe("new"); // admin phase starts actionable
    expect(vaultFill?.assigneeId).toBe(managerDana);

    // Report tracking rows: 12 monthly + 4 quarterly for the current year.
    const reports = await db
      .select()
      .from(clientReports)
      .where(eq(clientReports.clientId, client.id));
    expect(reports).toHaveLength(16);

    // Intake linked and stamped.
    const linked = await getIntake(intake.id);
    expect(linked.status).toBe("completed");
    expect(linked.clientId).toBe(client.id);
    expect(linked.convertedAt).not.toBeNull();

    expect(result.onboardingTasksCreated).toBe(9);
    expect(result.reportRowsCreated).toBe(16);
    expect(result.recurringRulesCreated).toBe(8); // 4 defaults + 1 custom + 1 merchant recon (I6) + 2 specialty report rules (C10)
    expect(result.tasksGenerated).not.toBeNull();
  });

  it("the seeded onboarding template lists the vault-fill row as admin-phase (A46)", async () => {
    // A46 (00:57:03): the vault slots seed at conversion (3B); this template
    // row is what prompts the manager to fill them. The admin template list
    // (listOnboardingTemplates) is what the template editor renders.
    const rows = await listOnboardingTemplates();
    const vault = rows.find((r) => r.title === "Fill in login credentials in the secure vault");
    expect(vault).toBeDefined();
    expect(vault?.isAdminPhase).toBe(true);
    expect(vault?.defaultAssigneeRole).toBe("manager");
    // Positioned right after "Collect signed engagement letter and W-9".
    const w9 = rows.find((r) => r.title === "Collect signed engagement letter and W-9");
    expect(vault!.position).toBe(w9!.position + 1);
  });

  it("creates property rows from the real-estate intake answers", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Riverbend Holdings LLC",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        isRealEstateClient: true,
        propertyCount: 3,
        propertyTypes: ["single_family", "commercial"],
        depreciationTracking: ["land_value", "building_value", "furniture_fixtures", "not_a_bucket"],
      },
    });

    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    expect(result.propertiesCreated).toBe(3);

    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.isRealEstateClient).toBe(true);

    const rows = await db.select().from(properties).where(eq(properties.clientId, client.id));
    expect(rows).toHaveLength(3);
    // The count is honored and the chosen types cycle across the rows.
    expect(rows.map((r) => r.name).sort()).toEqual(["Property 1", "Property 2", "Property 3"]);
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get("Property 1")?.propertyType).toBe("single_family");
    expect(byName.get("Property 2")?.propertyType).toBe("commercial");
    expect(byName.get("Property 3")?.propertyType).toBe("single_family");
    // Depreciation toggles land as unknown-value entries; junk keys drop out.
    const depreciation = byName.get("Property 1")?.depreciation as Record<
      string,
      { value: number | null; known: boolean }
    >;
    expect(Object.keys(depreciation).sort()).toEqual(["building_value", "furniture_fixtures", "land_value"]);
    expect(depreciation.land_value).toEqual({ value: null, known: false });
  });

  it("creates no property rows for non-real-estate intakes", async () => {
    const intakeId = await reviewableIntake({
      legalName: "No Properties Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: { serviceKeys: ["bank_feed_management"], isRealEstateClient: false },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    expect(result.propertiesCreated).toBe(0);
    const rows = await db.select().from(properties).where(eq(properties.clientId, result.clientId));
    expect(rows).toHaveLength(0);
  });

  it("I3: maps per-type accounts with proof categories, institution links, and login-access vault slots", async () => {
    const [chase] = await db.select().from(institutions).where(eq(institutions.name, "Chase"));
    const [umpqua] = await db.select().from(institutions).where(eq(institutions.name, "Umpqua"));
    const intakeId = await reviewableIntake({
      legalName: "Proof Categories Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      accountingMethod: "cash",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        // The wizard's flattened payload (buildPatch writes this from the
        // per-type count cards): proof categories, institution ids, and the
        // online-access flags ride along. Statement day is never captured.
        accounts: [
          {
            name: "Operating",
            accountType: "checking",
            institution: "Chase",
            institutionId: chase.id,
            proofCategory: "statement",
            grantLoginAccess: true,
          },
          // Only the institution id arrives: the text snapshot resolves.
          { name: "Reserve", accountType: "savings", institutionId: umpqua.id, proofCategory: "statement" },
          { name: "Van loan", accountType: "loan", lender: "Columbia", balance: 14000, proofCategory: "statement" },
          { name: "Owner loan", accountType: "loan", lender: "Wren", proofCategory: "owner_declared" },
          { name: "Transit van", accountType: "vehicle", year: 2022, value: 28000, proofCategory: "bill_of_sale" },
          { name: "Espresso machine", accountType: "fixed_assets", assetType: "equipment", proofCategory: "owner_declared" },
        ],
      },
    });

    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const rows = await db.select().from(accounts).where(eq(accounts.clientId, result.clientId));
    const byName = new Map(rows.map((a) => [a.name, a]));

    // Proof category drives the statement day: statement -> month-end,
    // owner-declared / bill-of-sale -> no statement day (out of the queues).
    expect(byName.get("Operating")).toMatchObject({
      proofCategory: "statement",
      statementDay: 31,
      institutionId: chase.id,
      institution: "Chase",
    });
    expect(byName.get("Reserve")).toMatchObject({
      proofCategory: "statement",
      statementDay: 31,
      institutionId: umpqua.id,
      institution: "Umpqua", // resolved from the FK
    });
    expect(byName.get("Van loan")).toMatchObject({ proofCategory: "statement", statementDay: 31 });
    expect(byName.get("Owner loan")).toMatchObject({ proofCategory: "owner_declared", statementDay: null });
    expect(byName.get("Transit van")).toMatchObject({ proofCategory: "bill_of_sale", statementDay: null });
    expect(byName.get("Espresso machine")).toMatchObject({ proofCategory: "owner_declared", statementDay: null });

    // The online-access flag opens exactly one expected vault slot (3B).
    expect(result.credentialsExpectedCreated).toBe(1);
  });

  it("bank_selection_assigns_institution_sops", async () => {
    // I5 (the learning center): the SOP Becky wrote for Columbia Bank on an
    // older client is already keyed to the bank; a new intake just picks the
    // bank from the dropdown and the SOP set flows across at conversion.
    const theoId = await userIdByEmail("theo@blueledgerbooks.com");
    const [columbia] = await db.select().from(institutions).where(eq(institutions.name, "Columbia"));
    const sop = await createSopTemplate(theoId, {
      title: "Columbia Bank statement pull",
      content: "1. Log in to the Columbia portal\n2. Download the statement PDF",
      institutionKey: "Columbia",
    });

    const intakeId = await reviewableIntake({
      legalName: "Columbia River Outfitters",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        // The wizard's bank dropdown writes the institution id; the text
        // snapshot resolves from the institutions table at conversion.
        accounts: [
          {
            name: "Operating",
            accountType: "checking",
            institutionId: columbia.id,
            proofCategory: "statement",
          },
        ],
      },
    });

    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);

    // The bank selection resolved the account's institution from the FK.
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, result.clientId), eq(accounts.name, "Operating")));
    expect(account.institutionId).toBe(columbia.id);
    expect(account.institution).toBe("Columbia");

    // ...and the bank's SOPs were assigned: a mirrored client manual entry
    // plus a link on the client's reconciliation rule.
    const [mirror] = await db
      .select()
      .from(clientManualEntries)
      .where(and(eq(clientManualEntries.clientId, result.clientId), eq(clientManualEntries.sopTemplateId, sop.id)));
    expect(mirror.title).toBe("Columbia Bank statement pull");
    expect(mirror.content).toBe("1. Log in to the Columbia portal\n2. Download the statement PDF");

    const [reconRule] = await db
      .select()
      .from(recurringTasks)
      .where(and(eq(recurringTasks.clientId, result.clientId), eq(recurringTasks.title, "Reconcile Accounts")))
      .limit(1);
    expect(reconRule).toBeDefined();
    const links = await db
      .select()
      .from(recurringTaskSopLinks)
      .where(eq(recurringTaskSopLinks.sopTemplateId, sop.id));
    expect(links.some((l) => l.clientManualEntryId === mirror.id)).toBe(true);
    expect(links.some((l) => l.recurringTaskId === reconRule.id)).toBe(true);
  });

  it("stamps the QBO subscription facts from form_data onto the client (§15 pass-through)", async () => {
    const intakeId = await reviewableIntake({
      legalName: "QBO Stamp Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        qboUserCount: 3,
        qboSubscriptionTier: "plus",
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.qboUserCount).toBe(3);
    expect(client.qboSubscriptionTier).toBe("plus");
  });

  it("leaves the QBO facts null when the intake never captured them", async () => {
    const intakeId = await reviewableIntake({
      legalName: "No QBO Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: { serviceKeys: ["bank_feed_management"] },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.qboUserCount).toBeNull();
    expect(client.qboSubscriptionTier).toBeNull();
  });

  it("yields exactly one client under concurrent conversion (§29 lock fix)", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Race Condition Co",
      bookkeepingStartDate: "2026-01-01",
    });

    const outcomes = await Promise.allSettled([
      // One racer assigns staff, the other converts unstaffed: the lock
      // yields exactly one client regardless of the new optional-staff rule.
      convertIntakeToClient(intakeId, { managerId: managerDana, bookkeeperId: bookkeeperJorge }, managerDana, TEST_TODAY),
      convertIntakeToClient(intakeId, {}, managerPriya, TEST_TODAY),
    ]);
    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter((o) => o.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConversionError);

    const created = await db
      .select()
      .from(clients)
      .where(eq(clients.legalName, "Race Condition Co"));
    expect(created).toHaveLength(1);
  });

  it("rolls EVERYTHING back on failure: no bare client (§29 fix)", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Doomed Conversion Co",
      bookkeepingStartDate: "2026-01-01",
      // An invalid schedule type fails the enum constraint mid-transaction,
      // AFTER the client row has already been inserted.
      customRecurringRules: [
        { title: "Boom", scheduleType: "fortnightly" as never },
      ],
    });

    await expect(
      convertIntakeToClient(intakeId, { managerId: managerDana, bookkeeperId: bookkeeperJorge }, managerDana, TEST_TODAY),
    ).rejects.toThrow();

    const created = await db
      .select()
      .from(clients)
      .where(eq(clients.legalName, "Doomed Conversion Co"));
    expect(created).toHaveLength(0);
    const intake = await getIntake(intakeId);
    expect(intake.clientId).toBeNull();
    expect(intake.status).toBe("pending_review");
  });

  it("converts WITHOUT staff: full graph with null assignees (assignment is post-conversion)", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Unassigned Conversion Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      accountingMethod: "cash",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Checking", accountType: "checking" }],
      },
    });

    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);

    // Client record with null staff.
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.legalName).toBe("Unassigned Conversion Co");
    expect(client.managerId).toBeNull();
    expect(client.bookkeeperId).toBeNull();

    // The four default rules carry null assignees.
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, client.id));
    expect(rules).toHaveLength(4);
    expect(rules.every((r) => r.assigneeId === null)).toBe(true);

    // Onboarding tasks carry null assignees, same phases as staffed clients.
    const onboarding = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, client.id), eq(tasks.taskType, "onboarding")));
    expect(onboarding).toHaveLength(9);
    expect(onboarding.every((t) => t.assigneeId === null)).toBe(true);

    // Post-commit generation still runs; instances inherit null assignees.
    expect(result.tasksGenerated).not.toBeNull();
    const instances = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, client.id), eq(tasks.taskType, "recurring")));
    expect(instances.length).toBeGreaterThan(0);
    expect(instances.every((t) => t.assigneeId === null)).toBe(true);

    // The intake links and stamps null staff.
    const linked = await getIntake(intakeId);
    expect(linked.status).toBe("completed");
    expect(linked.clientId).toBe(client.id);
    expect(linked.managerId).toBeNull();
    expect(linked.bookkeeperId).toBeNull();
  });

  it("applies staff when provided, including a partial assignment", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Half Staffed Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
    });

    const result = await convertIntakeToClient(
      intakeId,
      { managerId: managerDana },
      managerDana,
      TEST_TODAY,
    );

    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.managerId).toBe(managerDana);
    expect(client.bookkeeperId).toBeNull();

    // Manager-role defaults get Dana; bookkeeper-role defaults stay null.
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, client.id));
    const byTitle = new Map(rules.map((r) => [r.title, r]));
    expect(byTitle.get("Client Questions")?.assigneeId).toBe(managerDana);
    expect(byTitle.get("Send Reports")?.assigneeId).toBe(managerDana);
    expect(byTitle.get("Reconcile Accounts")?.assigneeId).toBeNull();
    expect(byTitle.get("Categorize Transactions")?.assigneeId).toBeNull();
  });

  it("an unassigned client's work still materializes and lands in the queue", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Queue Without Staff Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      accountingMethod: "cash",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management", "account_reconciliations", "monthly_reporting_15"],
        accounts: [{ name: "Checking", accountType: "checking" }],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);

    const queue = await getUnifiedQueue(managerDana, TEST_TODAY);
    const cards = Object.values(queue.buckets).flat().filter((c) => c.clientId === result.clientId);
    expect(cards.length).toBeGreaterThan(0);
    // No card crashes on a null fallback assignee.
    expect(cards.every((c) => c.assigneeId === null)).toBe(true);
  });

  it("skips recurring rules, feeds, recons, and reports for project engagements (§19)", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Catch-Up Only Co",
      engagementType: "project",
      bookkeepingStartDate: "2026-01-01",
      reportDefinitions: [{ name: "Monthly Financial Package", frequency: "monthly" }],
    });

    const result = await convertIntakeToClient(
      intakeId,
      { managerId: managerPriya, bookkeeperId: bookkeeperSofia },
      managerPriya,
      TEST_TODAY,
    );
    expect(result.isProjectEngagement).toBe(true);
    expect(result.recurringRulesCreated).toBe(0);
    expect(result.reportRowsCreated).toBe(0);
    expect(result.tasksGenerated).toBeNull();

    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.isProjectEngagement).toBe(true);
    expect(client.requiresWeeklyBankFeeds).toBe(false);

    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, client.id));
    expect(rules).toHaveLength(0);
    const reports = await db
      .select()
      .from(clientReports)
      .where(eq(clientReports.clientId, client.id));
    expect(reports).toHaveLength(0);
    const recurringWork = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, client.id), eq(tasks.taskType, "recurring")));
    expect(recurringWork).toHaveLength(0);
  });

  it("cascades rename, staff change, cadence change, and billing resync", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Cascade Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      accountingMethod: "cash",
      bookkeepingStartDate: "2026-01-01",
      owners: [{ name: "Pat Miller", ownershipPercent: 100 }],
      formData: {
        serviceKeys: ["bank_feed_management", "account_reconciliations", "monthly_reporting_15"],
        accounts: [{ name: "Checking", accountType: "checking" }],
      },
    });
    const result = await convertIntakeToClient(
      intakeId,
      { managerId: managerDana, bookkeeperId: bookkeeperJorge },
      managerDana,
      TEST_TODAY,
    );
    const clientId = result.clientId;

    const before = (await db.select().from(clients).where(eq(clients.id, clientId)))[0];
    expect(before.bookkeepingFrequency).toBe("monthly");
    const beforeTemplate = before.recurringServicesTemplate as { service_key: string; quantity: number }[];
    expect(beforeTemplate.find((l) => l.service_key === "bank_feed_management")?.quantity).toBe(1);

    // Rename + staff change + cadence change, via the save-then-cascade path.
    const patch: IntakePatch = {
      legalName: "Cascade Co (Renamed)",
      managerId: managerPriya,
      bookkeepingFrequency: "quarterly",
      accountingMethod: "accrual",
      owners: [
        { name: "Pat Miller", ownershipPercent: 60 },
        { name: "Sam Miller", ownershipPercent: 40 },
      ],
    };
    await updateIntake(intakeId, patch);
    const summary = await cascadeIntakeToClient(intakeId, patch, TEST_TODAY);

    const after = (await db.select().from(clients).where(eq(clients.id, clientId)))[0];
    expect(after.legalName).toBe("Cascade Co (Renamed)");
    expect(after.managerId).toBe(managerPriya);
    expect(after.bookkeepingFrequency).toBe("quarterly");

    // Resync stamped the template: quarterly cycle scales flat quantities x3.
    expect(summary.billingResynced).toBe(true);
    expect(after.billingLastSyncedAt).not.toBeNull();
    const afterTemplate = after.recurringServicesTemplate as { service_key: string; quantity: number }[];
    expect(afterTemplate.find((l) => l.service_key === "bank_feed_management")?.quantity).toBe(3);

    // Accounting method landed on the default rule titles.
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, clientId));
    expect(rules.map((r) => r.title)).toContain("Reconcile Accounts (accrual)");

    // Owners reconciled: re-percentaged Pat, added Sam.
    expect(summary.ownersRepercentaged).toBe(1);
    expect(summary.ownersAdded).toBe(1);
    const ownerLinks = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, clientId), eq(contactClientLinks.relationshipType, "owner")));
    expect(ownerLinks).toHaveLength(2);
  });

  it("cascade flips to project engagement one way only", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Flip Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
    });
    const result = await convertIntakeToClient(
      intakeId,
      { managerId: managerDana, bookkeeperId: bookkeeperSofia },
      managerDana,
      TEST_TODAY,
    );

    const flip = await cascadeIntakeToClient(intakeId, { engagementType: "project" }, TEST_TODAY);
    expect(flip.flippedToProject).toBe(true);
    let client = (await db.select().from(clients).where(eq(clients.id, result.clientId)))[0];
    expect(client.isProjectEngagement).toBe(true);
    expect(client.requiresWeeklyBankFeeds).toBe(false);
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, client.id));
    expect(rules.every((r) => !r.isActive)).toBe(true);

    // One-way: flipping back to bookkeeping is a no-op.
    const back = await cascadeIntakeToClient(intakeId, { engagementType: "bookkeeping" }, TEST_TODAY);
    expect(back.flippedToProject).toBe(false);
    client = (await db.select().from(clients).where(eq(clients.id, result.clientId)))[0];
    expect(client.isProjectEngagement).toBe(true);
  });

  it("I1: consulting engagement converts on the project-engagement track", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Consulting Co",
      engagementType: "consulting",
      bookkeepingStartDate: "2026-01-01",
      reportDefinitions: [{ name: "Monthly Financial Package", frequency: "monthly" }],
      formData: { serviceKeys: ["bank_feed_management"] },
    });

    const result = await convertIntakeToClient(
      intakeId,
      { managerId: managerPriya, bookkeeperId: bookkeeperSofia },
      managerPriya,
      TEST_TODAY,
    );
    expect(result.isProjectEngagement).toBe(true);
    expect(result.recurringRulesCreated).toBe(0);
    expect(result.reportRowsCreated).toBe(0);

    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.isProjectEngagement).toBe(true);
    expect(client.requiresWeeklyBankFeeds).toBe(false);
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, client.id));
    expect(rules).toHaveLength(0);
  });

  it("I1: cascade flips consulting to the project track one way, same as project", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Consulting Flip Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
    });
    const result = await convertIntakeToClient(
      intakeId,
      { managerId: managerDana, bookkeeperId: bookkeeperSofia },
      managerDana,
      TEST_TODAY,
    );
    const flip = await cascadeIntakeToClient(intakeId, { engagementType: "consulting" }, TEST_TODAY);
    expect(flip.flippedToProject).toBe(true);
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.isProjectEngagement).toBe(true);
  });

  it("I1: the dedicated CPA card creates the CPA contact and cpa_contact_id", async () => {
    // J1 (C4): conversion dedup matches by normalized name+email, so this
    // test's CPA uses a unique identity - the create path stays pinned here
    // (the link path is covered by the J1 dedup tests below).
    const intakeId = await reviewableIntake({
      legalName: "CPA Card Co",
      engagementType: "project",
      formData: {
        hasCpa: true,
        cpaName: "Rainier Tax Partners",
        cpaEmail: "team@rainiertax.example",
        contacts: [
          { firstName: "Wren", lastName: "Okafor", email: "wren@x.co", isPrimary: true },
        ],
      },
    });

    const result = await convertIntakeToClient(
      intakeId,
      { managerId: managerPriya, bookkeeperId: bookkeeperSofia },
      managerPriya,
      TEST_TODAY,
    );
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.cpaContactId).not.toBeNull();
    expect(client.primaryContactId).not.toBeNull();

    const [cpa] = await db.select().from(contacts).where(eq(contacts.id, client.cpaContactId!));
    expect(cpa.firstName).toBe("Rainier");
    expect(cpa.lastName).toBe("Tax Partners");
    expect(cpa.email).toBe("team@rainiertax.example");
    const cpaLinks = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, client.id), eq(contactClientLinks.relationshipType, "cpa")));
    expect(cpaLinks).toHaveLength(1);
    expect(cpaLinks[0].contactId).toBe(client.cpaContactId);
  });

  it("I1: the CPA card does not double-create when a contact already has the cpa role", async () => {
    const intakeId = await reviewableIntake({
      legalName: "CPA No-Dupe Co",
      engagementType: "project",
      formData: {
        hasCpa: true,
        cpaName: "Cascade Tax Group",
        contacts: [{ entityName: "Cascade Tax Group", relationshipType: "cpa" }],
      },
    });
    const result = await convertIntakeToClient(
      intakeId,
      { managerId: managerPriya, bookkeeperId: null },
      managerPriya,
      TEST_TODAY,
    );
    const cpaLinks = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, result.clientId), eq(contactClientLinks.relationshipType, "cpa")));
    expect(cpaLinks).toHaveLength(1);
  });

  it("I1: custom Other answers pass through on the intake record and never mis-map", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Far-Fetched Co",
      engagementType: "project",
      taxStructure: "Other",
      quickbooksStatus: "Other", // not QuickBooks: no QBO facts may stick
      formData: {
        customAnswers: {
          "tax-structure": "Series LLC taxed as a trust",
          "qbo-status": "Wave",
        },
        // A far-fetched payroll frequency must not poison the quote engine.
        payrollFrequency: "Other" as never,
        hasPayroll: true,
        serviceKeys: ["process_payroll"],
      },
    });

    const result = await convertIntakeToClient(
      intakeId,
      { managerId: managerPriya, bookkeeperId: bookkeeperSofia },
      managerPriya,
      TEST_TODAY,
    );
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    // The custom tax structure text lands verbatim on the client record.
    expect(client.taxStructure).toBe("Other");
    // No QBO pass-through facts for a non-QuickBooks custom answer.
    expect(client.qboUserCount).toBeNull();
    expect(client.qboSubscriptionTier).toBeNull();
    // The custom text rides the intake record untouched.
    const row = await getIntake(intakeId);
    const form = row.formData as { customAnswers?: Record<string, string> };
    expect(form.customAnswers?.["tax-structure"]).toBe("Series LLC taxed as a trust");
    expect(form.customAnswers?.["qbo-status"]).toBe("Wave");
  });

  it("I1+I6: owner phone reaches the owner contact; receivesReports stamps the link", async () => {
    // J1 (C4): conversion links an owner whose name+email matches an existing
    // contact - this test's owners use unique emails so the create path (and
    // its phone propagation) stays pinned; linking is covered below.
    const intakeId = await reviewableIntake({
      legalName: "Owner Detail Co",
      engagementType: "project",
      owners: [
        { name: "Wren Okafor", email: "wren@owner-detail.example", phone: "5035550182", receivesReports: true },
        { name: "Sal Vega", email: "sal@owner-detail.example" },
      ],
      formData: {
        owners: [
          { name: "Wren Okafor", email: "wren@owner-detail.example", phone: "5035550182", receivesReports: false },
          { name: "Sal Vega", email: "sal@owner-detail.example", receivesReports: true },
        ],
      },
    });

    const result = await convertIntakeToClient(
      intakeId,
      { managerId: managerPriya, bookkeeperId: null },
      managerPriya,
      TEST_TODAY,
    );
    const ownerLinks = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, result.clientId), eq(contactClientLinks.relationshipType, "owner")));
    expect(ownerLinks).toHaveLength(2);
    const byContact = new Map(
      await Promise.all(
        ownerLinks.map(async (l) => {
          const [c] = await db.select().from(contacts).where(eq(contacts.id, l.contactId));
          return [c.lastName ?? c.firstName, { link: l, contact: c }] as const;
        }),
      ),
    );
    // The form_data copy wins for the phone/receivesReports merge by name.
    const wren = byContact.get("Okafor")!;
    expect(wren.contact.phone).toBe("5035550182");
    expect(wren.link.receivesReports).toBe(false);
    // An owner without the checkbox answers still defaults to receiving.
    const sal = byContact.get("Vega")!;
    expect(sal.link.receivesReports).toBe(true);
  });

  it("I2: a corporate structure stamps has_payroll even when payroll went unanswered", async () => {
    // S-corp column value, no payroll answer anywhere in form_data.
    const scorpId = await reviewableIntake({
      legalName: "Officer Payroll Co",
      engagementType: "project",
      taxStructure: "S-corp",
      formData: { serviceKeys: ["bank_feed_management"] },
    });
    const scorp = await convertIntakeToClient(scorpId, {}, managerPriya, TEST_TODAY);
    const [scorpClient] = await db.select().from(clients).where(eq(clients.id, scorp.clientId));
    expect(scorpClient.hasPayroll).toBe(true);

    // LLC taxed as a C corp: the subclass rides form_data only.
    const llcId = await reviewableIntake({
      legalName: "LLC C-corp Co",
      engagementType: "project",
      taxStructure: "LLC",
      formData: { llcSubclass: "llc_ccorp", serviceKeys: ["bank_feed_management"] },
    });
    const llc = await convertIntakeToClient(llcId, {}, managerPriya, TEST_TODAY);
    const [llcClient] = await db.select().from(clients).where(eq(clients.id, llc.clientId));
    expect(llcClient.taxStructure).toBe("LLC");
    expect(llcClient.hasPayroll).toBe(true);
  });

  it("I2: a non-corporate structure with no payroll answer stays off payroll", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Sole Prop Co",
      engagementType: "project",
      taxStructure: "Sole proprietorship",
      formData: { serviceKeys: ["bank_feed_management"] },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerPriya, TEST_TODAY);
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.hasPayroll).toBe(false);
  });

  it("I2: cascade keeps the guard - an entity edit to a corporate structure stamps has_payroll", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Cascade Payroll Guard Co",
      engagementType: "project",
      taxStructure: "Sole proprietorship",
      formData: { serviceKeys: ["bank_feed_management"] },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerPriya, TEST_TODAY);
    const [before] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(before.hasPayroll).toBe(false);

    // The entity is edited after conversion; payroll was never answered.
    await updateIntake(intakeId, { taxStructure: "S-corp" });
    await cascadeIntakeToClient(intakeId, { taxStructure: "S-corp" }, TEST_TODAY);
    const [after] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(after.taxStructure).toBe("S-corp");
    expect(after.hasPayroll).toBe(true);
  });

  it("I2: leaving corporate does NOT clear a genuinely-answered payroll flag", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Real Payroll Co",
      engagementType: "project",
      taxStructure: "S-corp",
      formData: { serviceKeys: ["bank_feed_management"], hasPayroll: true },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerPriya, TEST_TODAY);
    // The payroll answer was real - an entity edit alone must not erase it.
    await updateIntake(intakeId, {
      taxStructure: "LLC",
      formData: { llcSubclass: "llc_sml" },
    });
    await cascadeIntakeToClient(
      intakeId,
      { taxStructure: "LLC", formData: { llcSubclass: "llc_sml" } },
      TEST_TODAY,
    );
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.taxStructure).toBe("LLC");
    expect(client.hasPayroll).toBe(true);
  });

  // ── I6: conversion wiring sweep (logic map §2 + the flagged loose ends) ──

  it("I6 migration: receives_reports exists with a true default; clients gains payroll_provider", async () => {
    const [col] = await db.execute(sql`
      SELECT is_nullable AS "isNullable", column_default AS "columnDefault"
      FROM information_schema.columns
      WHERE table_name = 'contact_client_links' AND column_name = 'receives_reports'
    `);
    expect(col).toBeDefined();
    expect(col.isNullable).toBe("NO");
    expect(String(col.columnDefault)).toContain("true");
    const [pcol] = await db.execute(sql`
      SELECT data_type AS "dataType"
      FROM information_schema.columns
      WHERE table_name = 'clients' AND column_name = 'payroll_provider'
    `);
    expect(pcol).toBeDefined();
    expect(pcol.dataType).toBe("text");
  });

  it("I6: the payroll provider rides onto the client and cascades on edits", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Provider Note Co",
      taxStructure: "S-corp",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        hasPayroll: true,
        payrollProvider: "Gusto",
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerPriya, TEST_TODAY);
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.hasPayroll).toBe(true);
    expect(client.payrollProvider).toBe("Gusto");

    // A post-conversion provider edit flows through the direct field map.
    await updateIntake(intakeId, { payrollProvider: "ADP" });
    await cascadeIntakeToClient(intakeId, { payrollProvider: "ADP" }, TEST_TODAY);
    const [after] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(after.payrollProvider).toBe("ADP");
  });

  it("I6: merchant recon seeds the monthly task only when the answer is yes", async () => {
    const yesId = await reviewableIntake({
      legalName: "Merchant Yes Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management", "merchant_account_reconciliation"],
        merchantAccounts: [{ name: "Stripe", processor: "Stripe" }],
        includeMerchantReconciliation: true,
      },
    });
    const yes = await convertIntakeToClient(yesId, {}, managerDana, TEST_TODAY);
    const yesRules = await db
      .select()
      .from(recurringTasks)
      .where(and(eq(recurringTasks.clientId, yes.clientId), eq(recurringTasks.title, "Merchant reconciliation")));
    expect(yesRules).toHaveLength(1);
    expect(yesRules[0].scheduleType).toBe("monthly");
    expect(yesRules[0].dayOfMonth).toBe(10);

    // No answer (or a no) seeds nothing - no orphan tasks.
    const noId = await reviewableIntake({
      legalName: "Merchant No Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        merchantAccounts: [{ name: "Stripe", processor: "Stripe" }],
        includeMerchantReconciliation: false,
      },
    });
    const no = await convertIntakeToClient(noId, {}, managerDana, TEST_TODAY);
    const noRules = await db
      .select()
      .from(recurringTasks)
      .where(and(eq(recurringTasks.clientId, no.clientId), eq(recurringTasks.title, "Merchant reconciliation")));
    expect(noRules).toHaveLength(0);
  });

  it("I6: owner edits cascade email/phone and the receives-reports flag to matched contacts", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Owner Cascade Co",
      engagementType: "project",
      owners: [{ name: "Pat Miller", email: "pat@x.co", ownershipPercent: 100 }],
      formData: {
        owners: [
          { name: "Pat Miller", email: "pat@x.co", phone: "5035550111", receivesReports: true },
        ],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerPriya, TEST_TODAY);
    const clientId = result.clientId;

    const before = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, clientId), eq(contactClientLinks.relationshipType, "owner")));
    expect(before).toHaveLength(1);
    expect(before[0].receivesReports).toBe(true);
    const [contactBefore] = await db.select().from(contacts).where(eq(contacts.id, before[0].contactId));
    expect(contactBefore.phone).toBe("5035550111");

    // Post-conversion edit: new email + phone, reports opted out, plus a new owner.
    const patch: IntakePatch = {
      owners: [
        { name: "Pat Miller", email: "pat.miller@x.co", phone: "5035550222", receivesReports: false, ownershipPercent: 60 },
        { name: "Sam Miller", email: "sam@x.co", phone: "5035550333", receivesReports: true, ownershipPercent: 40 },
      ],
    };
    await updateIntake(intakeId, patch);
    const summary = await cascadeIntakeToClient(intakeId, patch, TEST_TODAY);
    expect(summary.ownersAdded).toBe(1);

    const links = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, clientId), eq(contactClientLinks.relationshipType, "owner")));
    expect(links).toHaveLength(2);
    const pat = links.find((l) => l.contactId === before[0].contactId)!;
    expect(pat.receivesReports).toBe(false);
    const [patContact] = await db.select().from(contacts).where(eq(contacts.id, pat.contactId));
    expect(patContact.email).toBe("pat.miller@x.co");
    expect(patContact.phone).toBe("5035550222");
    // The newly added owner carries the submitted flag too.
    const sam = links.find((l) => l.id !== before[0].id)!;
    expect(sam.receivesReports).toBe(true);
    const [samContact] = await db.select().from(contacts).where(eq(contacts.id, sam.contactId));
    expect(samContact.email).toBe("sam@x.co");
  });

  it("I6: a receives-reports edit sent as a form_data owner slice cascades too", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Owner Slice Co",
      engagementType: "project",
      owners: [{ name: "Pat Miller", email: "pat@x.co", ownershipPercent: 100 }],
      formData: {
        owners: [{ name: "Pat Miller", email: "pat@x.co", receivesReports: true }],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerPriya, TEST_TODAY);

    // The wizard autosaves step slices through form_data.owners.
    await updateIntake(intakeId, {
      formData: {
        owners: [{ name: "Pat Miller", email: "pat@x.co", receivesReports: false }],
      },
    });
    await cascadeIntakeToClient(
      intakeId,
      { formData: { owners: [{ name: "Pat Miller", email: "pat@x.co", receivesReports: false }] } },
      TEST_TODAY,
    );
    const [link] = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, result.clientId), eq(contactClientLinks.relationshipType, "owner")));
    expect(link.receivesReports).toBe(false);
  });

  it("I6: the CPA card cascades - create after conversion, then update in place, no dupe", async () => {
    const intakeId = await reviewableIntake({
      legalName: "CPA Cascade Co",
      engagementType: "project",
      formData: { serviceKeys: ["bank_feed_management"] },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerPriya, TEST_TODAY);
    const clientId = result.clientId;
    let [client] = await db.select().from(clients).where(eq(clients.id, clientId));
    expect(client.cpaContactId).toBeNull();

    // Create path: the CPA card is answered after conversion.
    const createPatch: IntakePatch = {
      formData: { hasCpa: true, cpaName: "Cascade Tax Group", cpaEmail: "team@cascadetax.example" },
    };
    await updateIntake(intakeId, createPatch);
    const created = await cascadeIntakeToClient(intakeId, createPatch, TEST_TODAY);
    expect(created.cpaUpdated).toBe(true);

    [client] = await db.select().from(clients).where(eq(clients.id, clientId));
    expect(client.cpaContactId).not.toBeNull();
    const [cpa] = await db.select().from(contacts).where(eq(contacts.id, client.cpaContactId!));
    expect(cpa.firstName).toBe("Cascade");
    expect(cpa.lastName).toBe("Tax Group");
    expect(cpa.email).toBe("team@cascadetax.example");
    let cpaLinks = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, clientId), eq(contactClientLinks.relationshipType, "cpa")));
    expect(cpaLinks).toHaveLength(1);
    expect(cpaLinks[0].contactId).toBe(client.cpaContactId);

    // Update path: a name/email edit flows to the SAME contact - no dupe.
    const updatePatch: IntakePatch = {
      formData: { hasCpa: true, cpaName: "Renamed Tax Group", cpaEmail: "hello@renamed.example" },
    };
    await updateIntake(intakeId, updatePatch);
    const updated = await cascadeIntakeToClient(intakeId, updatePatch, TEST_TODAY);
    expect(updated.cpaUpdated).toBe(true);

    cpaLinks = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, clientId), eq(contactClientLinks.relationshipType, "cpa")));
    expect(cpaLinks).toHaveLength(1);
    const [cpaAfter] = await db.select().from(contacts).where(eq(contacts.id, cpaLinks[0].contactId));
    expect(cpaAfter.firstName).toBe("Renamed");
    expect(cpaAfter.lastName).toBe("Tax Group");
    expect(cpaAfter.email).toBe("hello@renamed.example");
    const [clientAfter] = await db.select().from(clients).where(eq(clients.id, clientId));
    expect(clientAfter.cpaContactId).toBe(cpaAfter.id);
  });

  it("I6: the CPA card update path also lands when the link exists but cpa_contact_id is null", async () => {
    // Legacy-shaped data: a cpa-role contact + link exist, but the client FK
    // is null (pre-link parity data, or an admin cleared it). The cascade
    // must find the link, update it, and backfill the client FK - never
    // duplicate.
    const intakeId = await reviewableIntake({
      legalName: "CPA Backfill Co",
      engagementType: "project",
      formData: {
        serviceKeys: ["bank_feed_management"],
        contacts: [{ entityName: "Cascade Tax Group", relationshipType: "cpa" }],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerPriya, TEST_TODAY);
    const clientId = result.clientId;
    await db.update(clients).set({ cpaContactId: null }).where(eq(clients.id, clientId));
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
    expect(client.cpaContactId).toBeNull();

    const patch: IntakePatch = {
      formData: { hasCpa: true, cpaName: "Cascade Tax Group", cpaEmail: "team@cascadetax.example" },
    };
    await updateIntake(intakeId, patch);
    await cascadeIntakeToClient(intakeId, patch, TEST_TODAY);

    const cpaLinks = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, clientId), eq(contactClientLinks.relationshipType, "cpa")));
    expect(cpaLinks).toHaveLength(1);
    const [clientAfter] = await db.select().from(clients).where(eq(clients.id, clientId));
    expect(clientAfter.cpaContactId).toBe(cpaLinks[0].contactId);
    const [cpaContact] = await db.select().from(contacts).where(eq(contacts.id, cpaLinks[0].contactId));
    expect(cpaContact.email).toBe("team@cascadetax.example");
  });

  it("I6 full logic-map graph: every §2 conversion row lands end-to-end", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Logic Map Co",
      taxStructure: "S-corp",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: [
          "bank_feed_management",
          "account_reconciliations",
          "merchant_account_reconciliation",
          "monthly_reporting_15",
          "class_tracking",
          "1099_collection",
          "1099_per_filing",
        ],
        hasPayroll: true,
        payrollProvider: "ADP",
        payrollFrequency: "monthly",
        paymentMethods: ["card"],
        merchantAccounts: [{ name: "Stripe", processor: "Stripe" }],
        includeMerchantReconciliation: true,
        estimated1099Count: 3,
        include1099Collection: true,
        qboClassNames: ["Retail", "Online"],
        personalCardForBusiness: true,
        reportDefinitions: [{ name: "Monthly Financial Package", frequency: "monthly" }],
        owners: [
          {
            name: "Wren Okafor",
            email: "wren@lm.co",
            phone: "5035550100",
            ownershipPercent: 100,
            receivesReports: true,
          },
        ],
        hasCpa: true,
        cpaName: "Cascade Tax Group",
        cpaEmail: "team@cascadetax.example",
        referralSource: "CPA referral",
        referralWho: "Cascade Tax Group",
      },
    });

    const result = await convertIntakeToClient(
      intakeId,
      { managerId: managerDana, bookkeeperId: bookkeeperSofia },
      managerDana,
      TEST_TODAY,
    );
    const clientId = result.clientId;
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId));

    // §2 - corporate entity: payroll required (I2) + provider note on the client.
    expect(client.hasPayroll).toBe(true);
    expect(client.payrollProvider).toBe("ADP");

    // §2 - payment methods = merchant processors: merchant recon add-on task
    // + the account on the books + the billing flag.
    const merchantRule = await db
      .select()
      .from(recurringTasks)
      .where(and(eq(recurringTasks.clientId, clientId), eq(recurringTasks.title, "Merchant reconciliation")));
    expect(merchantRule).toHaveLength(1);
    expect(client.includeMerchantReconciliation).toBe(true);

    // §2 - 1099 contractors: collection + filing count stamped (priced via the
    // services template; the 3C outreach automation chases vendors from here).
    expect(client.estimated1099Count).toBe(3);
    expect(client.include1099Collection).toBe(true);
    const template = client.recurringServicesTemplate as { service_key: string; quantity: number }[];
    expect(template.find((l) => l.service_key === "1099_collection")).toBeDefined();
    expect(template.find((l) => l.service_key === "1099_per_filing")?.quantity).toBe(3);

    // §2 - income tracking = classes: class tracking priced per class.
    expect(template.find((l) => l.service_key === "class_tracking")?.quantity).toBe(2);
    // §2 - report frequency + close tier: the reporting line prices at the 15 tier.
    expect(template.find((l) => l.service_key === "monthly_reporting_15")).toBeDefined();

    // §2 - personal card for business: the monthly breakdown reminder rule.
    const personalCard = await db
      .select()
      .from(recurringTasks)
      .where(and(eq(recurringTasks.clientId, clientId), eq(recurringTasks.title, PERSONAL_CARD_REMINDER_TITLE)));
    expect(personalCard).toHaveLength(1);

    // §2 - report frequency: the Client Questions rule runs on the same
    // (monthly) cadence as the reports.
    const questions = await db
      .select()
      .from(recurringTasks)
      .where(and(eq(recurringTasks.clientId, clientId), eq(recurringTasks.title, "Client Questions")));
    expect(questions[0].scheduleType).toBe("monthly");

    // §2 - owner "receives reports": the owner link carries the flag that
    // drives report delivery + portal visibility.
    const ownerLinks = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, clientId), eq(contactClientLinks.relationshipType, "owner")));
    expect(ownerLinks).toHaveLength(1);
    expect(ownerLinks[0].receivesReports).toBe(true);
    const [ownerContact] = await db.select().from(contacts).where(eq(contacts.id, ownerLinks[0].contactId));
    expect(ownerContact.phone).toBe("5035550100");

    // §2 - CPA exists: CPA contact + link + client FK.
    expect(client.cpaContactId).not.toBeNull();
    const cpaLinks = await db
      .select()
      .from(contactClientLinks)
      .where(and(eq(contactClientLinks.clientId, clientId), eq(contactClientLinks.relationshipType, "cpa")));
    expect(cpaLinks).toHaveLength(1);

    // §2 - referral = CPA: WHO is captured on the intake record.
    const row = await getIntake(intakeId);
    const form = row.formData as { referralWho?: string };
    expect(form.referralWho).toBe("Cascade Tax Group");

    // §2 - report selections: the monthly package materializes rows for the
    // current year and recurs as its own rule.
    const reports = await db.select().from(clientReports).where(eq(clientReports.clientId, clientId));
    expect(reports.length).toBeGreaterThan(0);
    const specialty = await db
      .select()
      .from(recurringTasks)
      .where(and(eq(recurringTasks.clientId, clientId), eq(recurringTasks.title, "Monthly Financial Package")));
    expect(specialty).toHaveLength(1);
  });
});

// ── J1 (meeting #3): dedup, identifiers, lenders, vehicle loans ───────────

describe.skipIf(!reachable)("J1 conversion: contact dedup + account identifiers", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    managerDana = await userIdByEmail("dana@blueledgerbooks.com");
  });

  it("contact_picker_never_duplicates_a_person: picker links, name+email matches link, name-only creates new", async () => {
    // The seed's CPA persona: Carlos Reyes <carlos@riverstonetax.com>.
    const [carlos] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.email, "carlos@riverstonetax.com"))
      .limit(1);
    expect(carlos).toBeDefined();
    const contactsBefore = await db.select().from(contacts);

    const intakeId = await reviewableIntake({
      legalName: "Dedup Test Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        contacts: [
          // Brand-new primary contact.
          { firstName: "Wren", lastName: "Okafor", email: "wren@dedup.example", isPrimary: true },
          // C5: picker-linked existing contact (the CPA card's record).
          { contactId: carlos.id, firstName: "Carlos", lastName: "Reyes", email: "carlos@riverstonetax.com", relationshipType: "related" },
        ],
        // C4: this owner IS the primary contact (the C1 same-as-primary
        // shortcut) - one record, two role links.
        owners: [{ name: "Wren Okafor", email: "wren@dedup.example", ownershipPercent: 100 }],
        // C6: the CPA card picker-linked Carlos too.
        hasCpa: true,
        cpaName: "Carlos Reyes",
        cpaEmail: "carlos@riverstonetax.com",
        cpaContactId: carlos.id,
      },
      owners: [{ name: "Wren Okafor", email: "wren@dedup.example", ownershipPercent: 100 }],
    });

    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    expect(result.contactsCreated).toBe(1); // only Wren is new
    expect(result.contactsLinked).toBe(3); // Carlos (contacts list + CPA card) + Wren (owner)

    const links = await db
      .select()
      .from(contactClientLinks)
      .where(eq(contactClientLinks.clientId, result.clientId));
    const byRole = (role: string) => links.filter((l) => l.relationshipType === role);
    expect(byRole("primary_contact")).toHaveLength(1);
    expect(byRole("owner")).toHaveLength(1);
    // Both roles point at the SAME Wren record.
    expect(byRole("primary_contact")[0].contactId).toBe(byRole("owner")[0].contactId);
    // Carlos was linked, never re-created: still the only Carlos row.
    const carlosRows = await db
      .select()
      .from(contacts)
      .where(eq(contacts.email, "carlos@riverstonetax.com"));
    expect(carlosRows).toHaveLength(1);
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.cpaContactId).toBe(carlos.id);
    expect(client.primaryContactId).not.toBe(carlos.id);

    // Exactly one new contacts row came out of the whole conversion.
    const contactsAfter = await db.select().from(contacts);
    expect(contactsAfter).toHaveLength(contactsBefore.length + 1);
  });

  it("a name-only match creates a NEW contact (safer than fuzzy)", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Name Collision Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        // Same NAME as the seeded Carlos Reyes but no email - two different
        // people may share a name, so this must not merge.
        contacts: [{ firstName: "Carlos", lastName: "Reyes", relationshipType: "related" }],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    expect(result.contactsCreated).toBe(1);
    expect(result.contactsLinked).toBe(0);
    const rows = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.firstName, "Carlos"), eq(contacts.lastName, "Reyes")));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("account_label_is_bank_type_last4: conversion stamps last4 and the vault slot renders the standard", async () => {
    const [chase] = await db.select().from(institutions).where(eq(institutions.name, "Chase"));
    const intakeId = await reviewableIntake({
      legalName: "Identifiers Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [
          // The wizard's derived-name payload: name IS the D2 label.
          {
            name: "Chase Checking · 4411",
            accountType: "checking",
            institution: "Chase",
            institutionId: chase.id,
            last4: "4411",
            proofCategory: "statement",
            grantLoginAccess: true,
          },
          // Garbage last-4 never reaches the column (app-layer check).
          { name: "Legacy Loan", accountType: "loan", lender: "Wren", proofCategory: "owner_declared", last4: "441" },
        ],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const rows = await db.select().from(accounts).where(eq(accounts.clientId, result.clientId));
    const byName = new Map(rows.map((a) => [a.name, a]));
    expect(byName.get("Chase Checking · 4411")).toMatchObject({ last4: "4411", institutionId: chase.id });
    expect(byName.get("Legacy Loan")?.last4).toBeNull();

    // The expected-credential vault slot carries the D2 label.
    const slots = await db
      .select()
      .from(clientCredentials)
      .where(eq(clientCredentials.clientId, result.clientId));
    expect(slots).toHaveLength(1);
    expect(slots[0].label).toBe("Chase Checking · 4411");
    expect(slots[0].institution).toBe("Chase");
  });

  it("owner_declared_lender_never_touches_institutions (D6)", async () => {
    const [columbia] = await db.select().from(institutions).where(eq(institutions.name, "Columbia"));
    const before = (await db.select().from(institutions)).length;
    const intakeId = await reviewableIntake({
      legalName: "Lender Routing Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [
          // Statement-proof: the lender is a bank-list pick (FK + snapshot).
          {
            name: "Van loan",
            accountType: "loan",
            lender: "Columbia",
            lenderInstitutionId: columbia.id,
            proofCategory: "statement",
          },
          // Owner-declared: a family-member write-in. It lands on the
          // account's text snapshot and NEVER enters the institutions table.
          { name: "Owner loan", accountType: "loan", lender: "Uncle Bob", proofCategory: "owner_declared" },
        ],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const rows = await db.select().from(accounts).where(eq(accounts.clientId, result.clientId));
    const byName = new Map(rows.map((a) => [a.name, a]));
    expect(byName.get("Van loan")).toMatchObject({
      institution: "Columbia",
      institutionId: columbia.id,
      proofCategory: "statement",
    });
    expect(byName.get("Owner loan")).toMatchObject({
      institution: "Uncle Bob",
      institutionId: null,
      proofCategory: "owner_declared",
    });
    // The institutions table is exactly as before.
    const after = await db.select().from(institutions);
    expect(after).toHaveLength(before);
    expect(after.some((i) => i.name.toLowerCase().includes("bob"))).toBe(false);
  });

  it("financed_vehicle_routes_to_loans: the linked entry converts as a vehicle_loan with statement defaults", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Financed Fleet Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        // What buildPatch flattens when a financed vehicle was entered: the
        // asset row AND the linked loan row.
        accounts: [
          { name: "Toyota Tundra", accountType: "vehicle", year: 2023, financed: "financed", proofCategory: "bill_of_sale" },
          {
            name: "Toyota Tundra (vehicle loan)",
            accountType: "vehicle_loan",
            lender: "Columbia",
            proofCategory: "statement",
            fromVehicle: "Toyota Tundra",
          },
        ],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const rows = await db.select().from(accounts).where(eq(accounts.clientId, result.clientId));
    const byName = new Map(rows.map((a) => [a.name, a]));
    expect(byName.get("Toyota Tundra")).toMatchObject({ accountType: "vehicle", proofCategory: "bill_of_sale" });
    // The vehicle loan is statement-producing: month-end statement day,
    // in the recon/statement queues.
    expect(byName.get("Toyota Tundra (vehicle loan)")).toMatchObject({
      accountType: "vehicle_loan",
      proofCategory: "statement",
      statementDay: 31,
      institution: "Columbia",
    });
  });

  it("merchant processors resolve the name snapshot from the picked FK (E4/DB1)", async () => {
    const [stripe] = await db.select().from(merchantProcessors).where(eq(merchantProcessors.name, "Stripe"));
    expect(stripe).toBeDefined();
    const intakeId = await reviewableIntake({
      legalName: "Processor Link Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        // The wizard writes both; an extraction payload may carry only the id.
        merchantAccounts: [{ name: "Stripe", processor: "Stripe", processorId: stripe.id }, { name: "Toast", processorId: (await db.select().from(merchantProcessors).where(eq(merchantProcessors.name, "Toast")))[0].id }],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const merchants = (await db.select().from(accounts).where(eq(accounts.clientId, result.clientId))).filter(
      (a) => a.accountType === "merchant",
    );
    const byName = new Map(merchants.map((a) => [a.name, a]));
    expect(byName.get("Stripe")?.institution).toBe("Stripe");
    // The id-only row resolved its processor name from the database.
    expect(byName.get("Toast")?.institution).toBe("Toast");
  });
});
