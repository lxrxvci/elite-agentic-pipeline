import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  accounts,
  clientCredentials,
  clientIntakes,
  clientManualEntries,
  clientNotes,
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
import {
  ConversionError,
  convertIntakeToClient,
  NON_BUSINESS_DEPOSITS_REVIEW_TITLE,
  OWNER_DRAWS_CONFIRMATION_TITLE,
  PERSONAL_CARD_REMINDER_TITLE,
} from "@/server/convert";
import { deriveRoutineTasks } from "@/components/intake/registry";
import { runRecurringOnce } from "@/server/recurring";
import { resolveRoutineEntries } from "@/shared/lib/routine-schedule";
import { PRELIMINARY_REPORTS_NOTE } from "@/shared/lib/default-rules";
import {
  createIntake,
  getIntake,
  markIntakeAccepted,
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

  // L6 (I3, 10_06 00:58:22): "we're not going to commit to a day of the
  // week schedule until the estimate is accepted." Conversion is gated on
  // the accepted state - pending_review cannot convert.
  it("L6/I3: day_commitment_blocked_before_acceptance", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Unaccepted Gate Co",
      bookkeepingStartDate: "2026-01-01",
    });
    const intake = await getIntake(intakeId);
    expect(intake.status).toBe("pending_review");
    await expect(convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY)).rejects.toThrow(
      /must be accepted before it can convert/,
    );

    // Acceptance opens the gate (pending_review -> accepted -> completed).
    await markIntakeAccepted(intakeId);
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    expect(result.clientId).toBeGreaterThan(0);
    expect((await getIntake(intakeId)).status).toBe("completed");
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

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intake.id);
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
    expect(rules).toHaveLength(9); // + the annual EOY tax checklist (E9)
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
    expect(result.recurringRulesCreated).toBe(9); // 4 defaults + EOY (E9) + 1 custom + 1 merchant recon (I6) + 2 specialty report rules (C10)
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

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
            last4: "4411",
            proofCategory: "statement",
            grantLoginAccess: true,
          },
          // Only the institution id arrives: the text snapshot resolves.
          { name: "Reserve", accountType: "savings", institutionId: umpqua.id, last4: "2210", proofCategory: "statement" },
          { name: "Van loan", accountType: "loan", lender: "Columbia", balance: 14000, proofCategory: "statement" },
          { name: "Owner loan", accountType: "loan", lender: "Wren", proofCategory: "owner_declared" },
          { name: "Transit van", accountType: "vehicle", year: 2022, value: 28000, proofCategory: "bill_of_sale" },
          { name: "Espresso machine", accountType: "fixed_assets", assetType: "equipment", proofCategory: "owner_declared" },
        ],
      },
    });

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
            last4: "8820",
            proofCategory: "statement",
          },
        ],
      },
    });

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): one acceptance covers both racers; the loser hits the lock.
    await markIntakeAccepted(intakeId);

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

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): the acceptance survives the rolled-back conversion.
    expect(intake.status).toBe("accepted");
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
        accounts: [{ name: "Checking", accountType: "checking", institution: "Chase", last4: "4411" }], // K7: identifiers complete (the conversion gate)
      },
    });

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    expect(rules).toHaveLength(5); // + the annual EOY tax checklist (E9)
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

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
        accounts: [{ name: "Checking", accountType: "checking", institution: "Chase", last4: "4411" }], // K7: identifiers complete (the conversion gate)
      },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
        accounts: [{ name: "Checking", accountType: "checking", institution: "Chase", last4: "4411" }], // K7: identifiers complete (the conversion gate)
      },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(scorpId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(llcId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(yesId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(noId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
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

describe.skipIf(!reachable)("J3 routine-schedule conversion (meeting #3, R1-R5)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    managerDana = await userIdByEmail("dana@blueledgerbooks.com");
    bookkeeperSofia = await userIdByEmail("sofia@blueledgerbooks.com");
  });

  type RuleRow = typeof recurringTasks.$inferSelect;
  async function rulesFor(clientId: number): Promise<Map<string, RuleRow>> {
    const rows = await db.select().from(recurringTasks).where(eq(recurringTasks.clientId, clientId));
    return new Map(rows.map((r) => [r.title, r]));
  }
  /** The rule fields the schedule drives - the comparison surface. */
  const shapeOf = (r: RuleRow) => ({
    scheduleType: r.scheduleType,
    daysOfWeek: r.daysOfWeek,
    dayOfMonth: r.dayOfMonth,
    weekday: r.weekday,
    weekOfMonth: r.weekOfMonth,
    anchorMonth: r.anchorMonth,
    weekInterval: r.weekInterval,
    nextRun: r.nextRun,
    isCustom: r.isCustom,
  });

  const SCHEDULE_BASE: IntakePatch = {
    legalName: "Scheduled Co",
    bookkeepingFrequency: "monthly",
    monthlyCloseTier: "10",
    accountingMethod: "cash",
    bookkeepingStartDate: "2026-08-03", // a Monday
    formData: {
      serviceKeys: ["bank_feed_management", "account_reconciliations", "monthly_reporting_10"],
    },
  };

  it("untouched and default-committed schedules convert identically to the legacy path", async () => {
    const legacyId = await reviewableIntake({ ...SCHEDULE_BASE, legalName: "Legacy Path Co" });
    // The same intake after the wizard's final screen committed the derived
    // defaults untouched (what Continue on an unmodified screen persists).
    const answers = {
      engagementType: "bookkeeping" as const,
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-08-03",
      serviceKeys: ["bank_feed_management", "account_reconciliations", "monthly_reporting_10"],
    };
    const derived = deriveRoutineTasks(answers);
    const schedule = resolveRoutineEntries(derived, null);
    const scheduledId = await reviewableIntake({
      ...SCHEDULE_BASE,
      legalName: "Scheduled Defaults Co",
      formData: { ...(SCHEDULE_BASE.formData ?? {}), routineSchedule: schedule },
    });

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(legacyId);
    const legacy = await convertIntakeToClient(legacyId, { bookkeeperId: bookkeeperSofia }, managerDana, TEST_TODAY);
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(scheduledId);
    const scheduled = await convertIntakeToClient(
      scheduledId,
      { bookkeeperId: bookkeeperSofia },
      managerDana,
      TEST_TODAY,
    );
    expect(scheduled.recurringRulesCreated).toBe(legacy.recurringRulesCreated);

    const legacyRules = await rulesFor(legacy.clientId);
    const scheduledRules = await rulesFor(scheduled.clientId);
    expect([...scheduledRules.keys()].sort()).toEqual([...legacyRules.keys()].sort());
    for (const [title, row] of legacyRules) {
      expect(shapeOf(scheduledRules.get(title)!), title).toEqual(shapeOf(row));
    }
    // Sanity: the four defaults, tier-day due dates (client questions = 25th).
    expect(legacyRules.get("Categorize Transactions")?.dayOfMonth).toBe(10);
    expect(legacyRules.get("Client Questions")?.dayOfMonth).toBe(25);
  });

  it("monthly_defaults_to_close_tier_day", async () => {
    // Entries with no explicit day (field defaults fill from the tier).
    const schedule = Object.fromEntries(
      ["categorize_transactions", "reconcile_accounts", "client_questions", "send_reports"].map((k, i) => [
        k,
        { bucket: "monthly" as const, order: i },
      ]),
    );
    const intakeId = await reviewableIntake({
      ...SCHEDULE_BASE,
      legalName: "Tier Default Co",
      formData: { ...(SCHEDULE_BASE.formData ?? {}), routineSchedule: schedule },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const rules = await rulesFor(result.clientId);
    expect(rules.get("Categorize Transactions")?.dayOfMonth).toBe(10);
    expect(rules.get("Reconcile Accounts")?.dayOfMonth).toBe(10);
    expect(rules.get("Send Reports")?.dayOfMonth).toBe(10);
    expect(rules.get("Client Questions")?.dayOfMonth).toBe(25);
  });

  it("weekly_every_2_weeks_on_friday_materializes_correctly", async () => {
    const intakeId = await reviewableIntake({
      ...SCHEDULE_BASE,
      legalName: "Biweekly Friday Co",
      customRecurringRules: [{ title: "Friday deposit sync", scheduleType: "weekly" }],
      formData: {
        ...(SCHEDULE_BASE.formData ?? {}),
        routineSchedule: {
          categorize_transactions: { bucket: "monthly", order: 0 },
          reconcile_accounts: { bucket: "monthly", order: 1 },
          client_questions: { bucket: "monthly", order: 2 },
          send_reports: { bucket: "monthly", order: 3 },
          "custom:Friday deposit sync": { bucket: "weekly", order: 0, weekdays: [5], everyNWeeks: 2 },
        },
      },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const rules = await rulesFor(result.clientId);
    const rule = rules.get("Friday deposit sync")!;
    expect(rule.scheduleType).toBe("weekly");
    expect(rule.daysOfWeek).toBe("5");
    expect(rule.weekInterval).toBe(2);
    // First Friday on the cadence anchored at the Aug 3 (Mon) start week.
    expect(rule.nextRun).toBe("2026-08-21"); // advanced past Aug 7 by generation

    // The post-commit generation materialized exactly the Aug 7 occurrence.
    const generated = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.recurringTaskId, rule.id), eq(tasks.clientId, result.clientId)));
    expect(generated).toHaveLength(1);
    expect(generated[0].dueDate).toBe("2026-08-07");

    // The engine walks it forward two weeks at a time (never the off week).
    const again = await runRecurringOnce({ year: 2026, month: 9, day: 4 });
    void again;
    const after = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.recurringTaskId, rule.id), eq(tasks.clientId, result.clientId)));
    expect(after.map((t) => t.dueDate).sort()).toEqual(["2026-08-07", "2026-08-21"]);
  });

  it("annual_fiscal_yearend_plus_45_days", async () => {
    const intakeId = await reviewableIntake({
      ...SCHEDULE_BASE,
      legalName: "Fiscal Year End Co",
      formData: {
        ...(SCHEDULE_BASE.formData ?? {}),
        routineSchedule: {
          categorize_transactions: { bucket: "monthly", order: 0 },
          reconcile_accounts: { bucket: "monthly", order: 1 },
          client_questions: { bucket: "monthly", order: 2 },
          send_reports: { bucket: "annual", order: 0, fiscalYearEnd: "06-30", daysAfterPeriodEnd: 45 },
        },
      },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const rules = await rulesFor(result.clientId);
    const rule = rules.get("Send Reports")!;
    // Fiscal June 30 + 45 days = August 14 - an annual rule anchored on August.
    expect(rule.scheduleType).toBe("annual");
    expect(rule.anchorMonth).toBe(8);
    expect(rule.dayOfMonth).toBe(14);
    expect(rule.nextRun).toBe("2027-08-14"); // 2026-08-14 materialized already
    const generated = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.recurringTaskId, rule.id), eq(tasks.clientId, result.clientId)));
    expect(generated.map((t) => t.dueDate)).toEqual(["2026-08-14"]);
  });

  it("add-on tasks seed only through the scheduler (payroll on -> payroll card -> payroll rule)", async () => {
    const payrollForm = {
      serviceKeys: ["bank_feed_management", "account_reconciliations", "monthly_reporting_10", "process_payroll"],
      hasPayroll: true,
      payrollFrequency: "biweekly" as const,
      payrollProvider: "Gusto",
    };
    const untouchedId = await reviewableIntake({
      ...SCHEDULE_BASE,
      legalName: "Payroll Untouched Co",
      payrollProvider: "Gusto",
      formData: payrollForm,
    });
    const scheduledId = await reviewableIntake({
      ...SCHEDULE_BASE,
      legalName: "Payroll Scheduled Co",
      payrollProvider: "Gusto",
      formData: {
        ...payrollForm,
        routineSchedule: resolveRoutineEntries(deriveRoutineTasks({
          engagementType: "bookkeeping",
          bookkeepingFrequency: "monthly",
          monthlyCloseTier: "10",
          bookkeepingStartDate: "2026-08-03",
          ...payrollForm,
        }), null),
      },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(untouchedId);
    const untouched = await convertIntakeToClient(untouchedId, {}, managerDana, TEST_TODAY);
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(scheduledId);
    const scheduled = await convertIntakeToClient(scheduledId, {}, managerDana, TEST_TODAY);
    expect((await rulesFor(untouched.clientId)).get("Payroll handling")).toBeUndefined();
    const rules = await rulesFor(scheduled.clientId);
    // The biweekly payroll cadence maps onto the J3 every-N-weeks support.
    expect(rules.get("Payroll handling")).toMatchObject({
      scheduleType: "weekly",
      daysOfWeek: "5",
      weekInterval: 2,
    });
    expect(scheduled.recurringRulesCreated).toBe(untouched.recurringRulesCreated + 1);
  });

  it("a standard routine removed on the screen never seeds (exclusions ride along)", async () => {
    const answers = {
      engagementType: "bookkeeping" as const,
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-08-03",
      serviceKeys: ["bank_feed_management"],
      excludedDefaultRules: ["client_questions"],
    };
    const schedule = resolveRoutineEntries(deriveRoutineTasks(answers), null);
    expect(schedule.client_questions).toBeUndefined();
    const intakeId = await reviewableIntake({
      ...SCHEDULE_BASE,
      legalName: "Excluded Routine Co",
      formData: { serviceKeys: ["bank_feed_management"], excludedDefaultRules: ["client_questions"], routineSchedule: schedule },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const rules = await rulesFor(result.clientId);
    expect(rules.get("Client Questions")).toBeUndefined();
    expect(result.recurringRulesCreated).toBe(4); // 3 remaining defaults + EOY (E9)
  });

  it("extraction-created intakes (no routineSchedule key) convert on the legacy path", async () => {
    // The call-notes extraction shape: flat form_data, custom rules on the
    // structured column, and never a routineSchedule key.
    const intakeId = await reviewableIntake({
      legalName: "Extraction Shaped Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-05",
      customRecurringRules: [{ title: "Weekly deposit review", scheduleType: "weekly", dayOfMonth: null }],
      formData: {
        serviceKeys: ["bank_feed_management", "account_reconciliations", "monthly_reporting_15"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
      },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    expect(result.recurringRulesCreated).toBe(6); // 4 defaults + EOY (E9) + 1 custom
    const rules = await rulesFor(result.clientId);
    expect(rules.get("Categorize Transactions")).toMatchObject({ scheduleType: "monthly", dayOfMonth: 15 });
    expect(rules.get("Weekly deposit review")).toMatchObject({
      scheduleType: "weekly",
      weekInterval: null,
      isCustom: true,
    });
  });
});


// ── J5 (meeting #3): the full-graph conversion extension for the J1-J4 shapes ─

describe.skipIf(!reachable)("J5 full-graph: every J1-J4 shape converts end-to-end", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    managerDana = await userIdByEmail("dana@blueledgerbooks.com");
  });

  it("the post-J4 intake shape (scheduler committed) converts into the complete graph", async () => {
    const [carlos] = await db.select().from(contacts).where(eq(contacts.email, "carlos@riverstonetax.com")).limit(1);
    const [chase] = await db.select().from(institutions).where(eq(institutions.name, "Chase"));
    const [columbia] = await db.select().from(institutions).where(eq(institutions.name, "Columbia"));
    const [stripe] = await db.select().from(merchantProcessors).where(eq(merchantProcessors.name, "Stripe"));

    // What the wizard persists after a full J1-J4 walk: services/software
    // answered at the END of the flow (the chapter order is presentation -
    // the form_data keys are unchanged), every new key captured, and the J3
    // routine schedule committed.
    const formData = {
      serviceKeys: ["bank_feed_management", "account_reconciliations", "monthly_reporting_10", "record_bills", "1099_collection"],
      contacts: [
        { firstName: "Wren", lastName: "Okafor", email: "wren@fullgraph.example", isPrimary: true },
        // J1 (C5): a picker-linked contact entry - linked, never duplicated.
        { contactId: carlos.id, firstName: "Carlos", lastName: "Reyes", email: "carlos@riverstonetax.com", relationshipType: "related" as const },
      ],
      owners: [{ name: "Wren Okafor", email: "wren@fullgraph.example", ownershipPercent: 100, receivesReports: true }],
      // J1 (C6): the CPA card picker-linked Carlos too.
      hasCpa: true,
      cpaName: "Carlos Reyes",
      cpaEmail: "carlos@riverstonetax.com",
      cpaContactId: carlos.id,
      accounts: [
        // J1 (D1/D2): the derived bank -> type -> last4 money account.
        {
          name: "Chase Checking · 4411",
          accountType: "checking",
          institution: "Chase",
          institutionId: chase.id,
          last4: "4411",
          proofCategory: "statement" as const,
          grantLoginAccess: true,
        },
        // J1 (D5): the financed vehicle + its auto-routed linked loan.
        { name: "2022 Ford Transit", accountType: "vehicle", year: 2022, financed: "financed" as const, proofCategory: "bill_of_sale" as const },
        {
          name: "2022 Ford Transit (vehicle loan)",
          accountType: "vehicle_loan",
          lender: "Columbia",
          lenderInstitutionId: columbia.id,
          proofCategory: "statement" as const,
          fromVehicle: "2022 Ford Transit",
        },
        // J1 (D6): an owner-declared lender write-in (never an institution).
        { name: "Owner loan", accountType: "loan", lender: "Uncle Bob", proofCategory: "owner_declared" as const },
      ],
      paymentMethods: ["card"],
      // J1 (E4/DB1): the processor pick carries the merchant_processors FK.
      merchantAccounts: [{ name: "Stripe", processorId: stripe.id }],
      includeMerchantReconciliation: true,
      // J2 (E1-E3): the three money-behavior yes answers + mandatory notes.
      depositsNonBusiness: true,
      personalOnBusiness: true,
      personalCardForBusiness: true,
      behaviorNotes: {
        "deposits-non-business": "Owner covers a bill from his personal account some months",
        "personal-on-business": "Groceries hit the business debit card",
        "personal-card": "The Amex picks up supplies",
      },
      // J2 (P1/P2/DB1): provider from the payroll_providers DB + self-processed.
      hasPayroll: true,
      payrollProvider: "Gusto",
      payrollFrequency: "monthly" as const,
      payrollSelfProcessed: true,
      // J2 (E6): the bills split with its payment locations.
      recordBills: true,
      payBills: true,
      billPayLocations: ["Vendor websites"],
      // J2: the 1099 estimated count at the per-filing rate.
      estimated1099Count: 4,
      include1099Collection: true,
      // J2 (R6): send reports before the open questions are answered.
      sendPreliminaryReports: true,
      servicePrices: { bank_feed_management: 90 },
      runningNotes: [{ text: "Wants the SOPs for Chase first.", at: "2026-08-01T00:00:00.000Z" }],
    };
    // J2 (missed filings): the yes/no + most-recent-filed date shape.
    const reportDefinitions = [
      { name: "Oregon Special Report", frequency: "quarterly", flatPrice: 450, missedFilings: true as const, lastFiledDate: "2026-03-31" },
    ];
    const customRecurringRules = [{ title: "Weekly deposit review", scheduleType: "weekly" as const }];
    // The committed J3 schedule, exactly as the untouched scheduler screen
    // persists it (Continue with no rearrangement).
    const routineSchedule = resolveRoutineEntries(
      deriveRoutineTasks({
        engagementType: "bookkeeping",
        bookkeepingFrequency: "monthly",
        monthlyCloseTier: "10",
        bookkeepingStartDate: "2026-01-01",
        ...formData,
        reportDefinitions,
        customRecurringRules,
      }),
      null,
    );

    const intakeId = await reviewableIntake({
      legalName: "Full Graph Co",
      taxStructure: "LLC",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      accountingMethod: "cash",
      bookkeepingStartDate: "2026-01-01",
      payrollProvider: "Gusto",
      // buildPatch maps internalNotes onto the structured column; conversion
      // reads it from there (same as the wizard's autosave).
      internalNotes: "Referred by Carlos.",
      reportDefinitions,
      customRecurringRules,
      formData: { ...formData, reportDefinitions, customRecurringRules, routineSchedule },
    });

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
    const result = await convertIntakeToClient(intakeId, { bookkeeperId: undefined }, managerDana, TEST_TODAY);
    const clientId = result.clientId;
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId));

    // ── Client record + notes channel (J2 P1/E6, running + internal notes) ──
    expect(client.payrollProvider).toBe("Gusto");
    expect(client.hasPayroll).toBe(true);
    const noteBodies = (await db.select().from(clientNotes).where(eq(clientNotes.clientId, clientId))).map((n) => n.body);
    expect(noteBodies).toContain("Bills: we record and pay them. Bills get paid at: Vendor websites.");
    expect(noteBodies).toContain("Payroll: they process their own payroll (Gusto) - we download and enter the reports.");
    expect(noteBodies).toContain("Wants the SOPs for Chase first.");
    expect(noteBodies).toContain("Referred by Carlos.");

    // ── Contacts: picker links, never duplicates (J1 C4-C6) ──
    expect(result.contactsCreated).toBe(1); // only Wren is new
    expect(result.contactsLinked).toBe(3); // Carlos x2 + the owner match
    expect(client.cpaContactId).toBe(carlos.id);
    expect(client.primaryContactId).not.toBe(carlos.id);
    const carlosRows = await db.select().from(contacts).where(eq(contacts.email, "carlos@riverstonetax.com"));
    expect(carlosRows).toHaveLength(1);

    // ── Accounts: identifiers, vehicle-loan link, lender routing (J1 D1-D6) ──
    const clientAccounts = await db.select().from(accounts).where(eq(accounts.clientId, clientId));
    const byName = new Map(clientAccounts.map((a) => [a.name, a]));
    expect(byName.get("Chase Checking · 4411")).toMatchObject({ last4: "4411", institutionId: chase.id, institution: "Chase" });
    expect(byName.get("2022 Ford Transit")).toMatchObject({ accountType: "vehicle", proofCategory: "bill_of_sale" });
    expect(byName.get("2022 Ford Transit (vehicle loan)")).toMatchObject({
      accountType: "vehicle_loan",
      institution: "Columbia",
      institutionId: columbia.id,
      proofCategory: "statement",
      statementDay: 31,
    });
    expect(byName.get("Owner loan")).toMatchObject({ institution: "Uncle Bob", institutionId: null, proofCategory: "owner_declared" });
    // E4/DB1: the merchant processor's name snapshot resolved from the FK.
    expect(byName.get("Stripe")).toMatchObject({ accountType: "merchant", institution: "Stripe" });
    // 3B + D2: the vault slot opened for the login-access account, labeled the standard.
    const slots = await db.select().from(clientCredentials).where(eq(clientCredentials.clientId, clientId));
    expect(slots).toHaveLength(1);
    expect(slots[0].label).toBe("Chase Checking · 4411");

    // ── Recurring rules through the J3 scheduler path: every J2 note rides ──
    const rules = await db.select().from(recurringTasks).where(eq(recurringTasks.clientId, clientId));
    const byTitle = new Map(rules.map((r) => [r.title, r]));
    expect(rules).toHaveLength(15); // + the annual EOY tax checklist (E9)
    expect(byTitle.get("Send Reports")).toMatchObject({ scheduleType: "monthly", dayOfMonth: 10, description: PRELIMINARY_REPORTS_NOTE });
    expect(byTitle.get(NON_BUSINESS_DEPOSITS_REVIEW_TITLE)?.description).toBe(
      "Client context from intake: Owner covers a bill from his personal account some months",
    );
    expect(byTitle.get(OWNER_DRAWS_CONFIRMATION_TITLE)?.description).toBe(
      "Client context from intake: Groceries hit the business debit card",
    );
    expect(byTitle.get(PERSONAL_CARD_REMINDER_TITLE)).toMatchObject({
      dayOfMonth: 1,
      description: "Client context from intake: The Amex picks up supplies",
    });
    // P1: the self-processed payroll routine the scheduler derives (no
    // payroll-processing work seeds).
    expect(byTitle.get("Download and enter payroll reports")).toMatchObject({ scheduleType: "monthly", dayOfMonth: 10 });
    expect(rules.some((r) => r.title === "Payroll handling")).toBe(false);
    // E6: the bills split as weekly routines.
    expect(byTitle.get("Record bills")).toMatchObject({ scheduleType: "weekly", daysOfWeek: "5" });
    expect(byTitle.get("Pay bills")).toMatchObject({ scheduleType: "weekly", daysOfWeek: "5" });
    // 1099s: annual year-end work (31 days after the calendar year ends).
    expect(byTitle.get("1099 collection")).toMatchObject({ scheduleType: "annual", anchorMonth: 1, dayOfMonth: 31 });
    // C10 + the custom rule pulled through the scheduler.
    expect(byTitle.get("Oregon Special Report")).toMatchObject({ scheduleType: "quarterly", isCustom: true });
    expect(byTitle.get("Weekly deposit review")).toMatchObject({ scheduleType: "weekly", daysOfWeek: "5", isCustom: true });

    // ── Billing template: J4 price overrides + J2 1099 count + missed filings ──
    const template = client.recurringServicesTemplate as {
      service_key: string;
      unit_price: number | null;
      quantity: number;
      discount: number;
      frequency: string;
      price_override?: number;
    }[];
    const line = (key: string) => template.find((l) => l.service_key === key);
    // V4: the $90 override carries as the equivalent per-cycle discount ($100
    // standard - $90 = $10) plus the raw field for transparency.
    expect(line("bank_feed_management")).toMatchObject({ unit_price: 100, discount: 10, price_override: 90 });
    // J2: the estimated count prices per filing.
    expect(line("1099_per_filing")?.quantity).toBe(4);
    // C10: the specialty report rides its own cadence; the missed June
    // quarter (last filed 2026-03-31, today 2026-08-15) prices one-time.
    expect(line("specialty_report_1")?.frequency).toBe("quarterly");
    expect(line("specialty_report_1_retro")).toMatchObject({ frequency: "one_time", quantity: 1 });

    // The stamped amount equals a fresh quote over the same answers.
    const expectedQuote = calculateIntakeQuote(
      { ...formData, reportDefinitions, bookkeepingFrequency: "monthly" },
      TEST_TODAY,
    );
    expect(Number(client.monthlyRecurringAmount)).toBeCloseTo(expectedQuote.totals.effectiveMonthly, 2);
  });

  it("service_prices_survive_conversion_and_the_cascade_billing_resync", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Price Override Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management", "account_reconciliations", "monthly_reporting_10"],
        accounts: [{ name: "Chase Checking · 4411", accountType: "checking", last4: "4411", proofCategory: "statement" }],
        servicePrices: { bank_feed_management: 90 },
      },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    const template = client.recurringServicesTemplate as {
      service_key: string;
      quantity: number;
      discount: number;
      price_override?: number;
    }[];
    // Conversion: the override is on the template (bills $90 via the discount).
    expect(template.find((l) => l.service_key === "bank_feed_management")).toMatchObject({
      discount: 10,
      price_override: 90,
    });

    // A post-conversion edit that reprices (a second account added) resyncs;
    // the override rides form_data into the rebuild, untouched.
    const stored = await getIntake(intakeId);
    const storedForm = (stored.formData ?? {}) as { accounts?: unknown[] };
    const patch: IntakePatch = {
      formData: {
        ...storedForm,
        accounts: [
          ...(storedForm.accounts ?? []),
          { name: "Chase Savings · 1005", accountType: "savings", last4: "1005", proofCategory: "statement" },
        ],
      } as IntakePatch["formData"],
    };
    await updateIntake(intakeId, patch);
    const summary = await cascadeIntakeToClient(intakeId, patch, TEST_TODAY);
    expect(summary.billingResynced).toBe(true);

    const [after] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    const resynced = after.recurringServicesTemplate as {
      service_key: string;
      quantity: number;
      discount: number;
      price_override?: number;
    }[];
    expect(resynced.find((l) => l.service_key === "bank_feed_management")).toMatchObject({
      discount: 10,
      price_override: 90,
    });
    // ...and the added account repriced the reconciliation line.
    expect(resynced.find((l) => l.service_key === "account_reconciliations")?.quantity).toBe(2);
  });

  // L5 (J3, 10_06 01:10:10): "is everything just grouped into owner's
  // equity? Are we doing contributions, distributions, net investment
  // gain/loss? Are we breaking it down by owner?" The intake's equity
  // answers drive the seeded equity accounts.
  it("L5/J3: equity_answers_seed_accounts_at_conversion - breakdown per owner", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Equity Seed Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        contacts: [
          { firstName: "Wren", lastName: "Okafor", email: "wren@equity-seed.example", isPrimary: true },
        ],
        owners: [{ name: "Wren Okafor" }, { name: "Daniel Reyes" }],
        equitySetup: "breakdown",
        equityBreakdown: ["contributions", "distributions", "net_investment"],
        equityPerOwner: true,
      },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intakeId);
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);
    const rows = await db.select().from(accounts).where(eq(accounts.clientId, result.clientId));
    const equityRows = rows
      .filter((r) => ["owner_contributions", "owner_distributions", "other_equity"].includes(r.accountType))
      .map((r) => r.name)
      .sort();
    expect(equityRows).toEqual([
      "Net Investment Gain/Loss - Daniel Reyes",
      "Net Investment Gain/Loss - Wren Okafor",
      "Owner Contributions - Daniel Reyes",
      "Owner Contributions - Wren Okafor",
      "Owner Distributions - Daniel Reyes",
      "Owner Distributions - Wren Okafor",
    ]);
  });

  it("L5/J3: grouped seeds a single owner's-equity account; unanswered keeps the default pair", async () => {
    const groupedId = await reviewableIntake({
      legalName: "Equity Grouped Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        contacts: [{ firstName: "Pat", lastName: "Doe", email: "pat@equity-grouped.example", isPrimary: true }],
        equitySetup: "grouped",
      },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(groupedId);
    const grouped = await convertIntakeToClient(groupedId, {}, managerDana, TEST_TODAY);
    const groupedRows = await db.select().from(accounts).where(eq(accounts.clientId, grouped.clientId));
    const groupedEquity = groupedRows.filter((r) =>
      ["owner_contributions", "owner_distributions", "other_equity"].includes(r.accountType),
    );
    expect(groupedEquity.map((r) => r.name)).toEqual(["Owner's Equity"]);
    expect(groupedEquity[0]!.proofCategory).toBe("owner_declared");
    expect(groupedEquity[0]!.statementDay).toBeNull();

    // Legacy path: no equity answer -> the §6.8 default pair, unchanged.
    const legacyId = await reviewableIntake({
      legalName: "Equity Default Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        contacts: [{ firstName: "Lee", lastName: "Ray", email: "lee@equity-default.example", isPrimary: true }],
      },
    });
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(legacyId);
    const legacy = await convertIntakeToClient(legacyId, {}, managerDana, TEST_TODAY);
    const legacyRows = await db.select().from(accounts).where(eq(accounts.clientId, legacy.clientId));
    expect(
      legacyRows
        .filter((r) => ["owner_contributions", "owner_distributions", "other_equity"].includes(r.accountType))
        .map((r) => r.name)
        .sort(),
    ).toEqual(["Owner Contributions", "Owner Distributions"]);
  });
});
