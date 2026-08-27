import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  accounts,
  clientIntakes,
  clientReports,
  clients,
  contactClientLinks,
  contacts,
  properties,
  recurringTasks,
  recurringTaskSubtasks,
  tasks,
  users,
} from "@/db/schema";
import { cascadeIntakeToClient } from "@/server/cascade";
import { ConversionError, convertIntakeToClient } from "@/server/convert";
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

    // Recurring rules: 4 defaults (monthly, tier day 10) + 1 custom weekly.
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, client.id));
    expect(rules).toHaveLength(5);
    const titles = rules.map((r) => r.title);
    for (const t of ["Reconcile Accounts", "Categorize Transactions", "Client Questions", "Send Reports"]) {
      expect(titles).toContain(t);
    }
    const custom = rules.find((r) => r.isCustom);
    expect(custom?.title).toBe("Weekly deposit review");
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

    // Onboarding tasks: 8 seeded template rows; admin phase starts new,
    // the rest blocked (§19).
    const onboarding = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, client.id), eq(tasks.taskType, "onboarding")));
    expect(onboarding).toHaveLength(8);
    expect(onboarding.filter((t) => t.status === "new")).toHaveLength(3);
    expect(onboarding.filter((t) => t.status === "blocked")).toHaveLength(5);

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

    expect(result.onboardingTasksCreated).toBe(8);
    expect(result.reportRowsCreated).toBe(16);
    expect(result.recurringRulesCreated).toBe(5);
    expect(result.tasksGenerated).not.toBeNull();
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
    expect(onboarding).toHaveLength(8);
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
});
