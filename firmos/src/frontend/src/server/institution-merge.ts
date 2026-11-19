import { and, eq, inArray, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import {
  accounts,
  clientIntakes,
  clientManualEntries,
  clientVendorAssignments,
  institutions,
  optionListValues,
  recurringTaskSopLinks,
  sopTemplates,
} from '@/db/schema'
import { normalizeInstitutionKey } from '@/shared/lib/institution-key'
import { logEvent, type DbOrTx } from './audit'
import type { IntakeFormData } from './intake'

export interface InstitutionMergePreview {
  source: { id: number; name: string }
  target: { id: number; name: string } | null
  requestedName: string
  mode: 'rename' | 'merge'
  clientCount: number
  accountCount: number
  sops: Array<{ id: number; title: string; side: 'source' | 'target' }>
  overlaps: Array<{ key: string; sourceId: number; sourceTitle: string; targetId: number; targetTitle: string }>
}

export type SopRetentionChoices = Record<string, 'source' | 'target'>

async function previewWith(tx: DbOrTx, sourceId: number, requestedName: string): Promise<InstitutionMergePreview> {
  const name = requestedName.trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('Give the institution a name first.')
  const [source] = await tx.select().from(institutions).where(eq(institutions.id, sourceId)).limit(1)
  if (!source) throw new Error('The institution no longer exists.')
  const key = normalizeInstitutionKey(name)!
  const [target] = await tx.select().from(institutions).where(sql`lower(btrim(${institutions.name})) = ${key}`).limit(1)
  const targetRow = target?.id === sourceId ? null : target ?? null
  const sourceKey = normalizeInstitutionKey(source.name)!
  const targetKey = normalizeInstitutionKey(targetRow?.name ?? name)!
  const affectedAccounts = await tx.select({ id: accounts.id, clientId: accounts.clientId }).from(accounts)
    .where(or(eq(accounts.institutionId, sourceId), sql`lower(btrim(${accounts.institution})) = ${sourceKey}`))
  const sops = await tx.select({ id: sopTemplates.id, title: sopTemplates.title, institutionKey: sopTemplates.institutionKey })
    .from(sopTemplates).where(and(inArray(sopTemplates.institutionKey, [sourceKey, targetKey]), eq(sopTemplates.isActive, true)))
  const sourceSops = sops.filter((sop) => sop.institutionKey === sourceKey)
  const targetSops = sops.filter((sop) => sop.institutionKey === targetKey)
  return {
    source: { id: source.id, name: source.name },
    target: targetRow ? { id: targetRow.id, name: targetRow.name } : null,
    requestedName: name,
    mode: targetRow ? 'merge' : 'rename',
    clientCount: new Set(affectedAccounts.map((account) => account.clientId)).size,
    accountCount: affectedAccounts.length,
    sops: [
      ...sourceSops.map((sop) => ({ id: sop.id, title: sop.title, side: 'source' as const })),
      ...targetSops.map((sop) => ({ id: sop.id, title: sop.title, side: 'target' as const })),
    ],
    overlaps: targetRow ? sourceSops.flatMap((sourceSop) => targetSops.map((targetSop) => ({
      key: `${sourceSop.id}:${targetSop.id}`,
      sourceId: sourceSop.id,
      sourceTitle: sourceSop.title,
      targetId: targetSop.id,
      targetTitle: targetSop.title,
    }))) : [],
  }
}

async function reassignSop(tx: DbOrTx, fromId: number, toId: number) {
  await tx.update(recurringTaskSopLinks).set({ sopTemplateId: toId }).where(eq(recurringTaskSopLinks.sopTemplateId, fromId))
  await tx.update(clientManualEntries).set({ sopTemplateId: toId, updatedAt: new Date() }).where(eq(clientManualEntries.sopTemplateId, fromId))
  await tx.update(clientVendorAssignments).set({ sopTemplateId: toId, updatedAt: new Date() }).where(eq(clientVendorAssignments.sopTemplateId, fromId))
  const catalogRows = await tx.select().from(optionListValues).where(sql`${optionListValues.meta}->>'sopTemplateId' = ${String(fromId)}`)
  for (const row of catalogRows) {
    const meta = row.meta != null && typeof row.meta === 'object' ? row.meta as Record<string, unknown> : {}
    await tx.update(optionListValues).set({ meta: { ...meta, sopTemplateId: toId } }).where(eq(optionListValues.id, row.id))
  }
}

async function updateIntakeSnapshots(tx: DbOrTx, sourceId: number, targetId: number, sourceName: string, targetName: string) {
  const rows = await tx.select().from(clientIntakes)
  const sourceKey = normalizeInstitutionKey(sourceName)
  for (const row of rows) {
    const form = (row.formData ?? {}) as IntakeFormData
    let changed = false
    const accountsForm = (form.accounts ?? []).map((account) => {
      if (account.institutionId !== sourceId && normalizeInstitutionKey(account.institution ?? account.lender) !== sourceKey) return account
      changed = true
      return { ...account, institutionId: targetId, institution: targetName, lenderInstitutionId: account.lenderInstitutionId === sourceId ? targetId : account.lenderInstitutionId, lender: account.lenderInstitutionId === sourceId ? targetName : account.lender }
    })
    const perType = Object.fromEntries(['checkingAccounts', 'savingsAccounts', 'creditCardAccounts', 'loanAccounts', 'vehicleAssets', 'otherAssets'].map((key) => [key, ((form[key] as IntakeFormData['accounts']) ?? []).map((account) => {
      if (account.institutionId !== sourceId && normalizeInstitutionKey(account.institution ?? account.lender) !== sourceKey) return account
      changed = true
      return { ...account, institutionId: targetId, institution: targetName, lenderInstitutionId: account.lenderInstitutionId === sourceId ? targetId : account.lenderInstitutionId, lender: account.lenderInstitutionId === sourceId ? targetName : account.lender }
    })]))
    if (changed) await tx.update(clientIntakes).set({ formData: { ...form, ...perType, accounts: accountsForm }, updatedAt: new Date() }).where(eq(clientIntakes.id, row.id))
  }
}

export async function previewInstitutionChange(sourceId: number, name: string): Promise<InstitutionMergePreview> {
  return previewWith(db, sourceId, name)
}

export async function applyInstitutionChange(
  sourceId: number,
  name: string,
  userId: number,
  confirmed: boolean,
  retention: SopRetentionChoices = {},
) {
  return db.transaction(async (tx) => {
    const preview = await previewWith(tx, sourceId, name)
    if (preview.mode === 'merge' && !confirmed) throw new Error('Review the affected records and confirm the merge first.')
    for (const overlap of preview.overlaps) {
      if (retention[overlap.key] !== 'source' && retention[overlap.key] !== 'target') {
        throw new Error(`Choose which SOP to retain for ${overlap.sourceTitle} and ${overlap.targetTitle}.`)
      }
    }
    const target = preview.target ?? { id: preview.source.id, name: preview.requestedName }
    const targetKey = normalizeInstitutionKey(target.name)!
    const now = new Date()
    await tx.update(accounts).set({ institutionId: target.id, institution: target.name, updatedAt: now })
      .where(or(eq(accounts.institutionId, preview.source.id), sql`lower(btrim(${accounts.institution})) = ${normalizeInstitutionKey(preview.source.name)}`))
    const retainedSops: Record<string, number> = {}
    if (preview.mode === 'rename') {
      await tx.update(institutions).set({ name: preview.requestedName }).where(eq(institutions.id, sourceId))
      await tx.update(sopTemplates).set({ institutionKey: targetKey, updatedAt: now })
        .where(and(eq(sopTemplates.institutionKey, normalizeInstitutionKey(preview.source.name)!), eq(sopTemplates.isActive, true)))
    } else {
      const sourceSopIds = preview.sops.filter((sop) => sop.side === 'source').map((sop) => sop.id)
      const targetSopIds = new Set(preview.sops.filter((sop) => sop.side === 'target').map((sop) => sop.id))
      const consumed = new Set<number>()
      for (const overlap of preview.overlaps) {
        const retainSource = retention[overlap.key] === 'source'
        const retainedId = retainSource ? overlap.sourceId : overlap.targetId
        const discardedId = retainSource ? overlap.targetId : overlap.sourceId
        retainedSops[overlap.key] = retainedId
        consumed.add(retainedId)
        consumed.add(discardedId)
        await reassignSop(tx, discardedId, retainedId)
        await tx.update(sopTemplates).set({ institutionKey: targetKey, isActive: true, updatedAt: now }).where(eq(sopTemplates.id, retainedId))
        await tx.update(sopTemplates).set({ isActive: false, changeNote: `Superseded during the ${preview.source.name} institution merge.`, updatedAt: now }).where(eq(sopTemplates.id, discardedId))
      }
      for (const id of sourceSopIds.filter((id) => !consumed.has(id))) {
        await tx.update(sopTemplates).set({ institutionKey: targetKey, updatedAt: now }).where(eq(sopTemplates.id, id))
      }
      for (const id of targetSopIds) {
        if (!consumed.has(id)) await tx.update(sopTemplates).set({ institutionKey: targetKey, updatedAt: now }).where(eq(sopTemplates.id, id))
      }
      await updateIntakeSnapshots(tx, preview.source.id, target.id, preview.source.name, target.name)
      await tx.delete(institutions).where(eq(institutions.id, preview.source.id))
    }
    if (preview.mode === 'rename') await updateIntakeSnapshots(tx, sourceId, target.id, preview.source.name, target.name)
    await logEvent({
      userId,
      action: preview.mode === 'merge' ? 'institution_merged' : 'institution_renamed',
      entityType: 'institution',
      entityId: target.id,
      metadata: { source: preview.source, target, clientCount: preview.clientCount, accountCount: preview.accountCount, retainedSops },
    }, tx)
    return { ...preview, retainedSops }
  })
}
