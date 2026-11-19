import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/db'
import { clientIntakes, clientVendorAssignments, optionListValues, sopTemplates } from '@/db/schema'
import { logEvent } from '@/server/audit'
import { addOptionValue, renameOptionValue } from '@/server/option-lists'
import { normalizeInstitutionKey } from '@/shared/lib/institution-key'
import { normalizePortalUrl } from '@/shared/lib/portal-url'

const VENDOR_LIST_KEY = 'record_bill_vendors'

export interface VendorCatalogRow {
  id: number
  name: string
  defaultPortalUrl: string | null
  sopTemplateId: number | null
  reusable: boolean
}

interface VendorMeta {
  defaultPortalUrl?: string | null
  sopTemplateId?: number | null
  reusable?: boolean
  intakeId?: number | null
}

export interface VendorDefaultsInput {
  defaultPortalUrl?: string | null
  sopTemplateId?: number | null
  reusable?: boolean
  intakeId?: number | null
}

function metaOf(row: { meta: unknown }): VendorMeta {
  return row.meta != null && typeof row.meta === 'object' ? row.meta as VendorMeta : {}
}

function toVendor(row: typeof optionListValues.$inferSelect): VendorCatalogRow {
  const meta = metaOf(row)
  let defaultPortalUrl: string | null = null
  try {
    defaultPortalUrl = normalizePortalUrl(meta.defaultPortalUrl)
  } catch {
    // Invalid legacy metadata is withheld instead of exposed as a payment link.
  }
  return {
    id: row.id,
    name: row.name,
    defaultPortalUrl,
    sopTemplateId: typeof meta.sopTemplateId === 'number' ? meta.sopTemplateId : null,
    reusable: meta.reusable !== false,
  }
}

export async function listVendorCatalog(intakeId?: number, industry?: string | null): Promise<VendorCatalogRow[]> {
  const normalizedIndustry = industry?.trim().toLowerCase() ?? ''
  const [rows, industryRows] = await Promise.all([
    db.select().from(optionListValues).where(and(
      eq(optionListValues.listKey, VENDOR_LIST_KEY),
      eq(optionListValues.isActive, true),
    )),
    normalizedIndustry === '' ? Promise.resolve([]) : db.select({ vendorId: clientVendorAssignments.vendorOptionId })
      .from(clientVendorAssignments).innerJoin(clientIntakes, eq(clientIntakes.clientId, clientVendorAssignments.clientId))
      .where(sql`lower(btrim(${clientIntakes.industry})) = ${normalizedIndustry}`),
  ])
  const used = new Set(industryRows.map((row) => row.vendorId))
  return rows.filter((row) => {
    const meta = metaOf(row)
    return meta.reusable !== false || meta.intakeId == null || meta.intakeId === intakeId
  }).map(toVendor).sort((a, b) => Number(used.has(b.id)) - Number(used.has(a.id)) || a.name.localeCompare(b.name))
}

async function vendorById(id: number): Promise<VendorCatalogRow> {
  const [row] = await db.select().from(optionListValues).where(and(
    eq(optionListValues.id, id),
    eq(optionListValues.listKey, VENDOR_LIST_KEY),
  )).limit(1)
  if (!row) throw new Error('That vendor no longer exists.')
  return toVendor(row)
}

export async function setVendorDefaults(
  id: number,
  input: VendorDefaultsInput,
  userId?: number,
): Promise<VendorCatalogRow> {
  const [row] = await db.select().from(optionListValues).where(and(
    eq(optionListValues.id, id),
    eq(optionListValues.listKey, VENDOR_LIST_KEY),
  )).limit(1)
  if (!row) throw new Error('That vendor no longer exists.')
  const previous = metaOf(row)
  const defaultPortalUrl = input.defaultPortalUrl === undefined
    ? previous.defaultPortalUrl ?? null
    : normalizePortalUrl(input.defaultPortalUrl)
  const sopTemplateId = input.sopTemplateId === undefined ? previous.sopTemplateId ?? null : input.sopTemplateId
  if (sopTemplateId != null) {
    const [sop] = await db.select({ id: sopTemplates.id }).from(sopTemplates).where(and(
      eq(sopTemplates.id, sopTemplateId), eq(sopTemplates.isActive, true),
    )).limit(1)
    if (!sop) throw new Error('Choose an active shared SOP.')
  }
  const meta: VendorMeta = {
    ...previous,
    defaultPortalUrl,
    sopTemplateId: sopTemplateId ?? null,
    ...(input.reusable === undefined ? {} : { reusable: input.reusable }),
    ...(input.intakeId === undefined ? {} : { intakeId: input.intakeId }),
  }
  await db.update(optionListValues).set({ meta }).where(eq(optionListValues.id, id))
  if (userId != null) {
    await logEvent({
      userId,
      action: 'vendor_defaults_updated',
      entityType: 'option_list',
      entityId: id,
      metadata: { hasPortalUrl: defaultPortalUrl != null, sopTemplateId: meta.sopTemplateId },
    })
  }
  return vendorById(id)
}

export async function addVendor(
  name: string,
  input: VendorDefaultsInput = {},
  userId?: number,
): Promise<VendorCatalogRow> {
  if (input.defaultPortalUrl !== undefined) normalizePortalUrl(input.defaultPortalUrl)
  if (input.sopTemplateId != null) {
    const [sop] = await db.select({ id: sopTemplates.id }).from(sopTemplates).where(and(
      eq(sopTemplates.id, input.sopTemplateId), eq(sopTemplates.isActive, true),
    )).limit(1)
    if (!sop) throw new Error('Choose an active shared SOP.')
  }
  const [prior] = await db.select().from(optionListValues).where(and(
    eq(optionListValues.listKey, VENDOR_LIST_KEY),
    sql`lower(${optionListValues.name}) = ${normalizeInstitutionKey(name)}`,
  )).limit(1)
  const row = await addOptionValue(VENDOR_LIST_KEY, name, userId)
  const previous = metaOf(row)
  if (previous.reusable === false && input.reusable === false && previous.intakeId != null && previous.intakeId !== input.intakeId) {
    throw new Error('A one-off vendor with this name already exists. Choose another name or make it reusable.')
  }
  return setVendorDefaults(row.id, {
    ...input,
    reusable: prior != null && previous.reusable !== false && input.reusable === false ? true : input.reusable,
  }, userId)
}

export async function renameVendor(id: number, name: string, userId: number): Promise<VendorCatalogRow> {
  await renameOptionValue(VENDOR_LIST_KEY, id, name, userId)
  return vendorById(id)
}
