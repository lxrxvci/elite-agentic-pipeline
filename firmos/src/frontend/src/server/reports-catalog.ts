import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/db'
import { optionListValues, sopTemplates } from '@/db/schema'
import { logEvent } from '@/server/audit'
import { addOptionValue, renameOptionValue } from '@/server/option-lists'
import { normalizeInstitutionKey } from '@/shared/lib/institution-key'

const REPORT_LIST_KEY = 'report_types'

export interface ReportCatalogRow {
  id: number
  name: string
  isCommon: boolean
  sopTemplateId: number | null
}

interface ReportMeta {
  isCommon?: boolean
  intakeId?: number | null
  sopTemplateId?: number | null
}

export interface ReportCatalogInput {
  isCommon: boolean
  intakeId: number
  sopTemplateId?: number | null
}

function metaOf(row: { meta: unknown }): ReportMeta {
  return row.meta != null && typeof row.meta === 'object' ? row.meta as ReportMeta : {}
}

function toReport(row: typeof optionListValues.$inferSelect): ReportCatalogRow {
  const meta = metaOf(row)
  return {
    id: row.id,
    name: row.name,
    isCommon: meta.isCommon !== false,
    sopTemplateId: meta.isCommon === false ? null : meta.sopTemplateId ?? null,
  }
}

export async function listReportCatalog(intakeId: number): Promise<ReportCatalogRow[]> {
  const rows = await db.select().from(optionListValues).where(and(
    eq(optionListValues.listKey, REPORT_LIST_KEY),
    eq(optionListValues.isActive, true),
  ))
  return rows.filter((row) => {
    const meta = metaOf(row)
    return meta.isCommon !== false || meta.intakeId === intakeId
  }).map(toReport).sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveReportCatalog(
  id: number,
  input: ReportCatalogInput,
  userId?: number,
): Promise<ReportCatalogRow> {
  const [existing] = await db.select().from(optionListValues).where(and(
    eq(optionListValues.id, id),
    eq(optionListValues.listKey, REPORT_LIST_KEY),
  )).limit(1)
  if (!existing) throw new Error('That report type no longer exists.')
  if (input.isCommon && input.sopTemplateId != null) {
    const [sop] = await db.select({ id: sopTemplates.id }).from(sopTemplates).where(and(
      eq(sopTemplates.id, input.sopTemplateId), eq(sopTemplates.isActive, true),
    )).limit(1)
    if (!sop) throw new Error('Choose an active shared SOP.')
  }
  const previous = metaOf(existing)
  const meta: ReportMeta = {
    ...previous,
    isCommon: input.isCommon,
    intakeId: input.isCommon ? null : input.intakeId,
    sopTemplateId: input.isCommon ? input.sopTemplateId ?? previous.sopTemplateId ?? null : null,
  }
  await db.update(optionListValues).set({ meta }).where(eq(optionListValues.id, id))
  if (userId != null) {
    await logEvent({
      userId,
      action: 'report_catalog_updated',
      entityType: 'option_list',
      entityId: id,
      metadata: { isCommon: input.isCommon, hasSop: meta.sopTemplateId != null },
    })
  }
  const [row] = await db.select().from(optionListValues).where(eq(optionListValues.id, id)).limit(1)
  return toReport(row)
}

export async function addReportType(
  name: string,
  input: ReportCatalogInput,
  userId?: number,
): Promise<ReportCatalogRow> {
  if (input.isCommon && input.sopTemplateId != null) {
    const [sop] = await db.select({ id: sopTemplates.id }).from(sopTemplates).where(and(
      eq(sopTemplates.id, input.sopTemplateId), eq(sopTemplates.isActive, true),
    )).limit(1)
    if (!sop) throw new Error('Choose an active shared SOP.')
  }
  const [prior] = await db.select().from(optionListValues).where(and(
    eq(optionListValues.listKey, REPORT_LIST_KEY),
    sql`lower(${optionListValues.name}) = ${normalizeInstitutionKey(name)}`,
  )).limit(1)
  const row = await addOptionValue(REPORT_LIST_KEY, name, userId)
  const existing = metaOf(row)
  if (existing.isCommon === false && !input.isCommon && existing.intakeId != null && existing.intakeId !== input.intakeId) {
    throw new Error('A client-specific report with this name already exists. Choose another name or mark it common.')
  }
  return saveReportCatalog(row.id, {
    ...input,
    isCommon: input.isCommon || (prior != null && existing.isCommon !== false),
  }, userId)
}

export async function renameReportType(id: number, name: string, userId: number): Promise<ReportCatalogRow> {
  await renameOptionValue(REPORT_LIST_KEY, id, name, userId)
  const [row] = await db.select().from(optionListValues).where(and(
    eq(optionListValues.id, id), eq(optionListValues.listKey, REPORT_LIST_KEY),
  )).limit(1)
  if (!row) throw new Error('That report type no longer exists.')
  return toReport(row)
}
