import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { chartAccountTemplates } from "@/db/schema";
import { logEvent } from "@/server/audit";
import type { ChartAccountTemplate, ChartTemplateKey } from "@/shared/lib/chart-templates";

export async function listChartTemplates(): Promise<ChartAccountTemplate[]> {
  const rows = await db.select().from(chartAccountTemplates).orderBy(asc(chartAccountTemplates.key), asc(chartAccountTemplates.version));
  return rows.map((row) => ({
    id: row.id,
    key: row.key as ChartTemplateKey,
    version: row.version,
    contributions: row.contributions,
    distributions: row.distributions,
    netInvestment: row.netInvestment,
    grouped: row.grouped,
    status: row.status as ChartAccountTemplate["status"],
    isActive: row.isActive,
  }));
}

export async function approveChartTemplate(id: number, actorId: number): Promise<ChartAccountTemplate | null> {
  const [row] = await db
    .update(chartAccountTemplates)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(chartAccountTemplates.id, id))
    .returning();
  if (!row) return null;
  await logEvent({
    userId: actorId,
    action: "chart_template_approved",
    entityType: "chart_account_template",
    entityId: id,
    metadata: { key: row.key, version: row.version },
  });
  return {
    id: row.id,
    key: row.key as ChartTemplateKey,
    version: row.version,
    contributions: row.contributions,
    distributions: row.distributions,
    netInvestment: row.netInvestment,
    grouped: row.grouped,
    status: "approved",
    isActive: row.isActive,
  };
}

export async function approvedChartTemplateFor(key: ChartTemplateKey): Promise<ChartAccountTemplate | null> {
  const [row] = await db
    .select()
    .from(chartAccountTemplates)
    .where(and(
      eq(chartAccountTemplates.key, key),
      eq(chartAccountTemplates.status, "approved"),
      eq(chartAccountTemplates.isActive, true),
    ))
    .orderBy(asc(chartAccountTemplates.version))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    key: row.key as ChartTemplateKey,
    version: row.version,
    contributions: row.contributions,
    distributions: row.distributions,
    netInvestment: row.netInvestment,
    grouped: row.grouped,
    status: "approved",
    isActive: row.isActive,
  };
}
