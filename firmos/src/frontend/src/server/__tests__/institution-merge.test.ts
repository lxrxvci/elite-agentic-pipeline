import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { db } from '@/db'
import { accounts, auditEvents, clientIntakes, clientManualEntries, clients, institutions, optionListValues, recurringTaskSopLinks, recurringTasks, sopTemplates, users } from '@/db/schema'
import { applyInstitutionChange, previewInstitutionChange } from '@/server/institution-merge'
import { seedDatabase } from '@/server/seed'
import { dbReachable, TEST_TODAY } from './helpers'

const reachable = await dbReachable()

describe.skipIf(!reachable)('institution rename and merge', () => {
  beforeAll(async () => { await seedDatabase(TEST_TODAY) })

  it('requires retention choices and transactionally merges accounts, work links, and audit history', async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, 'dana@blueledgerbooks.com'))
    const [source] = await db.insert(institutions).values({ name: 'Legacy Bank Merge Test' }).returning()
    const [target] = await db.insert(institutions).values({ name: 'Canonical Bank Merge Test' }).returning()
    const [client] = await db.insert(clients).values({ legalName: 'Institution Merge Test Co' }).returning()
    const insertedAccounts = await db.insert(accounts).values([
      { clientId: client.id, name: 'Canonical account', accountType: 'checking', institutionId: source.id, institution: source.name },
      { clientId: client.id, name: 'Legacy text account', accountType: 'checking', institution: source.name.toUpperCase() },
    ]).returning()
    const [sourceSop] = await db.insert(sopTemplates).values({ title: 'Legacy download', content: 'Original source procedure', institutionKey: source.name.toLowerCase() }).returning()
    const [targetSop] = await db.insert(sopTemplates).values({ title: 'Canonical download', content: 'Current target procedure', institutionKey: target.name.toLowerCase() }).returning()
    const [rule] = await db.insert(recurringTasks).values({ clientId: client.id, title: 'Download statement', scheduleType: 'monthly' }).returning()
    await db.insert(recurringTaskSopLinks).values([{ recurringTaskId: rule.id, sopTemplateId: sourceSop.id }, { recurringTaskId: rule.id, sopTemplateId: targetSop.id }])
    const [manual] = await db.insert(clientManualEntries).values({ clientId: client.id, title: 'Bank procedure', sopTemplateId: sourceSop.id, content: 'Client-specific details' }).returning()
    const [option] = await db.insert(optionListValues).values({ listKey: 'record_bill_vendors', name: 'Merge test vendor', meta: { sopTemplateId: sourceSop.id } }).returning()

    const preview = await previewInstitutionChange(source.id, target.name)
    expect(preview).toMatchObject({ mode: 'merge', clientCount: 1, accountCount: 2 })
    expect(preview.overlaps).toHaveLength(1)
    await expect(applyInstitutionChange(source.id, target.name, owner.id, false)).rejects.toThrow(/confirm/)
    await expect(applyInstitutionChange(source.id, target.name, owner.id, true)).rejects.toThrow(/Choose which SOP/)
    expect((await db.select().from(institutions).where(eq(institutions.id, source.id)))).toHaveLength(1)

    const result = await applyInstitutionChange(source.id, target.name, owner.id, true, { [`${sourceSop.id}:${targetSop.id}`]: 'target' })
    expect(result.retainedSops).toEqual({ [`${sourceSop.id}:${targetSop.id}`]: targetSop.id })
    const updated = await db.select().from(accounts).where(eq(accounts.clientId, client.id))
    expect(updated.every((account) => account.institutionId === target.id && account.institution === target.name)).toBe(true)
    expect((await db.select().from(institutions).where(eq(institutions.id, source.id)))).toHaveLength(0)
    expect((await db.select().from(sopTemplates).where(eq(sopTemplates.id, sourceSop.id)))[0]).toMatchObject({ isActive: false, content: 'Original source procedure' })
    expect((await db.select().from(sopTemplates).where(eq(sopTemplates.id, targetSop.id)))[0]).toMatchObject({ isActive: true, content: 'Current target procedure' })
    const links = await db.select().from(recurringTaskSopLinks).where(eq(recurringTaskSopLinks.recurringTaskId, rule.id))
    expect(links.every((link) => link.sopTemplateId === targetSop.id)).toBe(true)
    expect((await db.select().from(clientManualEntries).where(eq(clientManualEntries.id, manual.id)))[0]).toMatchObject({ sopTemplateId: targetSop.id, content: 'Client-specific details' })
    expect((await db.select().from(optionListValues).where(eq(optionListValues.id, option.id)))[0].meta).toMatchObject({ sopTemplateId: targetSop.id })
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, 'institution_merged'))
    expect(audit.some((event) => event.entityId === target.id)).toBe(true)
    expect(insertedAccounts.map((account) => account.id)).toHaveLength(2)
  })

  it('renames canonical and legacy text references and saved intake snapshots', async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, 'dana@blueledgerbooks.com'))
    const [source] = await db.insert(institutions).values({ name: 'Rename Source Bank' }).returning()
    const [client] = await db.insert(clients).values({ legalName: 'Institution Rename Test Co' }).returning()
    await db.insert(accounts).values({ clientId: client.id, name: 'Checking', accountType: 'checking', institutionId: source.id, institution: source.name })
    await db.insert(sopTemplates).values({ title: 'Rename SOP', institutionKey: 'rename source bank' })
    const intake = await db.insert(clientIntakes).values({ legalName: client.legalName, formData: { accounts: [{ name: 'Checking', accountType: 'checking', institutionId: source.id, institution: source.name }] } }).returning()
    const preview = await previewInstitutionChange(source.id, 'Rename Destination Bank')
    expect(preview.mode).toBe('rename')
    await applyInstitutionChange(source.id, preview.requestedName, owner.id, false)
    expect((await db.select().from(institutions).where(eq(institutions.id, source.id)))[0].name).toBe('Rename Destination Bank')
    expect((await db.select().from(accounts).where(eq(accounts.clientId, client.id)))[0]).toMatchObject({ institutionId: source.id, institution: 'Rename Destination Bank' })
    expect((await db.select().from(sopTemplates).where(eq(sopTemplates.title, 'Rename SOP')))[0].institutionKey).toBe('rename destination bank')
    const form = (await db.select().from(clientIntakes).where(eq(clientIntakes.id, intake[0].id)))[0].formData as import('@/server/intake').IntakeFormData
    expect(form.accounts?.[0]).toMatchObject({ institutionId: source.id, institution: 'Rename Destination Bank' })
  })

  it('rolls back all changes when the audit write fails after reassignment', async () => {
    const [source] = await db.insert(institutions).values({ name: 'Rollback Source Bank' }).returning()
    const [target] = await db.insert(institutions).values({ name: 'Rollback Target Bank' }).returning()
    const [client] = await db.insert(clients).values({ legalName: 'Institution Rollback Test Co' }).returning()
    const [account] = await db.insert(accounts).values({ clientId: client.id, name: 'Checking', accountType: 'checking', institutionId: source.id, institution: source.name }).returning()
    await expect(applyInstitutionChange(source.id, target.name, -1, true)).rejects.toThrow()
    expect((await db.select().from(institutions).where(eq(institutions.id, source.id)))[0].name).toBe(source.name)
    expect((await db.select().from(accounts).where(eq(accounts.id, account.id)))[0]).toMatchObject({ institutionId: source.id, institution: source.name })
  })
})
