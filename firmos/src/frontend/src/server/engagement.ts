import { eq } from "drizzle-orm";

import { answersFromIntake } from "@/components/intake/registry";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { AcceptedEstimateSnapshot, AgreementTemplate } from "@/shared/lib/engagement";

import { calculateIntakeQuoteWithConfig } from "./quote";
import type { IntakeRow } from "./intake";

export type { AcceptedEstimateSnapshot, AgreementTemplate } from "@/shared/lib/engagement";
export { renderEngagementAgreement } from "@/shared/lib/engagement";

export async function buildAcceptedEstimateSnapshot(intake: IntakeRow): Promise<AcceptedEstimateSnapshot> {
  const answers = answersFromIntake(intake);
  const quote = await calculateIntakeQuoteWithConfig(answers);
  return {
    version: 1,
    acceptedAt: new Date().toISOString(),
    answers,
    quote,
  };
}

export async function getEngagementAgreementTemplate(): Promise<AgreementTemplate | null> {
  const [templateRow] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "engagement_agreement_template"))
    .limit(1);
  if (typeof templateRow?.value !== "string" || templateRow.value.trim() === "") return null;
  const [orgRow] = await db.select().from(appSettings).where(eq(appSettings.key, "org_profile")).limit(1);
  const firmName = orgRow && typeof orgRow.value === "object" && orgRow.value !== null && "name" in orgRow.value
    ? String((orgRow.value as { name?: unknown }).name ?? "")
    : "";
  return { body: templateRow.value, firmName };
}
