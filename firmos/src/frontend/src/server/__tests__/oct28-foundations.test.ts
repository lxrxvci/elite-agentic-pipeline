import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { accounts, chartAccountTemplates, users } from "@/db/schema";
import { convertIntakeToClient } from "@/server/convert";
import { approveChartTemplate, approvedChartTemplateFor, listChartTemplates } from "@/server/chart-templates";
import { chartTemplateKeyFor } from "@/shared/lib/chart-templates";
import { equitySeedPlan } from "@/shared/lib/account-types";
import { createIntake, getIntake, markIntakeAccepted, submitIntakeForReview } from "@/server/intake";
import { renderEngagementAgreement, type AcceptedEstimateSnapshot } from "@/server/engagement";
import { seedDatabase } from "@/server/seed";
import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

describe.skipIf(!reachable)("October 28 chart and document foundations", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    await db.insert(chartAccountTemplates).values([
      { key: "sole_proprietor", contributions: "Owner Contribution", distributions: "Owner's Draw", netInvestment: "Net Investment Gain/Loss", grouped: "Owner's Equity", status: "draft" },
      { key: "partnership", contributions: "Partner Contribution", distributions: "Partner Distribution", netInvestment: "Net Investment Gain/Loss", grouped: "Partner's Equity", status: "draft" },
      { key: "corporation", contributions: "Shareholder Contribution", distributions: "Shareholder Distribution", netInvestment: "Net Investment Gain/Loss", grouped: "Shareholder Equity", status: "draft" },
    ]);
    await db.update(chartAccountTemplates).set({ status: "draft" });
  });

  it("chartTemplateKeyFor maps sole proprietor, partnership, and corporate structures", () => {
    expect(chartTemplateKeyFor({ taxStructure: "Sole proprietorship" })).toBe("sole_proprietor");
    expect(chartTemplateKeyFor({ taxStructure: "LLC", llcSubclass: "llc_partnership" })).toBe("partnership");
    expect(chartTemplateKeyFor({ taxStructure: "S-corp" })).toBe("corporation");
  });

  it("only approved chart templates affect equity naming", async () => {
    const templates = await listChartTemplates();
    expect(templates).toHaveLength(3);
    expect(templates.every((template) => template.status === "draft")).toBe(true);

    const corporation = templates.find((template) => template.key === "corporation")!;
    const [actor] = await db.select().from(users).where(eq(users.email, "dana@blueledgerbooks.com"));
    await approveChartTemplate(corporation.id, actor.id);
    const approved = await approvedChartTemplateFor("corporation");
    expect(approved).toMatchObject({ status: "approved", contributions: "Shareholder Contribution" });

    const plan = equitySeedPlan({
      equitySetup: "breakdown",
      equityBreakdown: ["contributions", "distributions"],
      equityPerOwner: true,
      owners: [{ name: "A" }, { name: "B" }],
    }, approved!);
    expect(plan?.map((row) => row.name)).toEqual([
      "Shareholder Contribution - A",
      "Shareholder Distribution - A",
      "Shareholder Contribution - B",
      "Shareholder Distribution - B",
    ]);

    await db.update(chartAccountTemplates).set({ status: "draft" });
  });

  it("an approved corporate template changes the accounts seeded at conversion", async () => {
    const corporation = (await listChartTemplates()).find((template) => template.key === "corporation")!;
    const [actor] = await db.select().from(users).where(eq(users.email, "dana@blueledgerbooks.com"));
    await approveChartTemplate(corporation.id, actor.id);

    const row = await createIntake({
      legalName: "Approved Chart Co",
      taxStructure: "S-corp",
      bookkeepingStartDate: "2026-01-01",
      owners: [
        { name: "A", email: "a@example.com", ownershipPercent: 50 },
        { name: "B", email: "b@example.com", ownershipPercent: 50 },
      ],
      formData: {
        serviceKeys: ["bank_feed_management"],
        owners: [
          { name: "A", email: "a@example.com", ownershipPercent: 50 },
          { name: "B", email: "b@example.com", ownershipPercent: 50 },
        ],
        equitySetup: "breakdown",
        equityBreakdown: ["contributions", "distributions"],
        equityPerOwner: true,
      },
    });
    await submitIntakeForReview(row.id);
    await markIntakeAccepted(row.id);
    const result = await convertIntakeToClient(row.id, {}, actor.id, TEST_TODAY);
    const seeded = await db.select().from(accounts).where(eq(accounts.clientId, result.clientId));
    expect(seeded.map((account) => account.name)).toEqual(expect.arrayContaining([
      "Shareholder Contribution - A",
      "Shareholder Distribution - A",
      "Shareholder Contribution - B",
      "Shareholder Distribution - B",
    ]));
    await db.update(chartAccountTemplates).set({ status: "draft" });
  });

  it("acceptance captures an immutable snapshot and renders only the supplied agreement text", async () => {
    const row = await createIntake({
      legalName: "Snapshot Co",
      formData: { serviceKeys: ["bank_feed_management"] },
    });
    await submitIntakeForReview(row.id);
    await markIntakeAccepted(row.id);
    const intake = await getIntake(row.id);
    const snapshot = intake.acceptedEstimateSnapshot as AcceptedEstimateSnapshot;

    expect(snapshot.version).toBe(1);
    expect(snapshot.answers.legalName).toBe("Snapshot Co");
    expect(snapshot.quote.lines.map((line) => line.service_key)).toContain("bank_feed_management");
    expect(snapshot.quote.totals.effectiveMonthly).toBe(100);

    const body = renderEngagementAgreement(snapshot, {
      firmName: "Blue Ledger Books",
      body: "Agreement for {{clientName}} by {{firmName}}. Monthly: ${{monthlyRecurring}}. One-time: ${{oneTimeTotal}}. Accepted {{acceptedAt}}.",
    });
    expect(body).toContain("Agreement for Snapshot Co by Blue Ledger Books");
    expect(body).toContain("Monthly: $100.00");
    expect(body).toContain(snapshot.acceptedAt);
  });
});
