import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { inArray } from 'drizzle-orm'

import { institutions, sopTemplates } from '../src/db/schema'
import { OWNER_COOKIES_FILE } from './global-setup'

test.beforeEach(async ({ context, baseURL }) => {
  const storage = JSON.parse(readFileSync(OWNER_COOKIES_FILE, 'utf8'))
  await context.addCookies(storage.cookies.map((cookie: { name: string; value: string }) => ({ name: cookie.name, value: cookie.value, url: baseURL ?? 'http://localhost:3200' })))
})

test('a contact persists before conversion and links to the resumable intake', async ({ page }) => {
  await page.goto('/intake')
  await page.getByTestId('start-new-intake').click()
  await page.getByTestId('new-intake-name').fill('Contact History Browser Co')
  await page.getByTestId('new-intake-create').click()
  await page.waitForURL((url) => /^\/intake\/\d+$/.test(url.pathname))
  const intakeUrl = page.url()
  await page.getByLabel('Full name').fill('Intake History Contact')
  await page.getByLabel('Email', { exact: true }).fill('intake-history@example.com')
  await page.getByLabel('Phone', { exact: true }).fill('5035550188')
  await page.getByTestId('continue').click()
  await expect(page.getByTestId('question-screen')).toHaveAttribute('data-question', 'address')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.goto('/contacts')
  await page.getByRole('link', { name: 'Intake History Contact', exact: true }).click()
  await expect(page.getByTestId('contact-name')).toHaveText('Intake History Contact')
  await expect(page.getByRole('link', { name: 'Contact History Browser Co' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Resume intake' })).toBeVisible()
  await page.screenshot({ path: 'test-results/november18/contact-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'test-results/november18/contact-mobile.png', fullPage: true })
  await page.getByRole('link', { name: 'Resume intake' }).click()
  await expect(page).toHaveURL(intakeUrl)
  await expect(page.getByTestId('question-screen')).toHaveAttribute('data-question', 'tax-structure')
})

test('admin previews and merges institutions with an explicit SOP choice', async ({ page }) => {
  process.env.DATABASE_URL ??= `postgres://${process.env.USER ?? 'postgres'}@localhost:5432/firmos`
  const { db } = await import('../src/db')
  const [source] = await db.insert(institutions).values({ name: 'Browser Legacy Institution' }).returning()
  const [target] = await db.insert(institutions).values({ name: 'Browser Canonical Institution' }).returning()
  const insertedSops = await db.insert(sopTemplates).values([
    { title: 'Browser legacy procedure', institutionKey: 'browser legacy institution', content: 'Legacy steps' },
    { title: 'Browser canonical procedure', institutionKey: 'browser canonical institution', content: 'Canonical steps' },
  ]).returning()
  try {
    await page.goto('/admin/institutions')
    await page.getByRole('button', { name: 'Rename or merge Browser Legacy Institution' }).click()
    await page.getByLabel('Institution name').fill('Browser Canonical Institution')
    await page.getByRole('button', { name: 'Review affected records' }).click()
    await expect(page.getByTestId('institution-merge-preview')).toContainText('2 active SOPs')
    await expect(page.getByRole('button', { name: 'Merge institutions' })).toBeDisabled()
    await page.screenshot({ path: 'test-results/november18/institution-merge-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.screenshot({ path: 'test-results/november18/institution-merge-mobile.png', fullPage: true })
    const { violations } = await new AxeBuilder({ page }).include('[data-testid="institution-merge-dialog"]').analyze()
    expect(violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
    await page.getByRole('radio', { name: /Browser canonical procedure/ }).check()
    await page.getByRole('button', { name: 'Merge institutions' }).click()
    await expect(page.getByRole('status')).toContainText('Browser Legacy Institution merged into Browser Canonical Institution')
    expect(await db.select().from(institutions).where(inArray(institutions.id, [source.id, target.id]))).toEqual([expect.objectContaining({ id: target.id })])
    expect(await db.select().from(sopTemplates).where(inArray(sopTemplates.id, insertedSops.map((sop) => sop.id)))).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Browser legacy procedure', isActive: false }),
      expect.objectContaining({ title: 'Browser canonical procedure', isActive: true }),
    ]))
  } finally {
    await db.delete(sopTemplates).where(inArray(sopTemplates.id, insertedSops.map((sop) => sop.id)))
    await db.delete(institutions).where(inArray(institutions.id, [source.id, target.id]))
  }
})
