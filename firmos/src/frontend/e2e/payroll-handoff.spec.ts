import { expect, request as apiRequest, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import postgres from 'postgres'

import { OWNER_COOKIES_FILE } from './global-setup'

const sql = postgres(process.env.DATABASE_URL ?? 'postgres://lxrxcvi@localhost:5432/firmos')

test.afterAll(async () => {
  await sql.end()
})

test('Gusto handoff downloads deduplicated client hours without exposing credentials', async ({ page, context, baseURL }) => {
  const storage = JSON.parse(readFileSync(OWNER_COOKIES_FILE, 'utf8'))
  await context.addCookies(storage.cookies.map((cookie: { name: string; value: string }) => ({
    name: cookie.name, value: cookie.value, url: baseURL ?? 'http://localhost:3200',
  })))
  const [client] = await sql`insert into clients (legal_name, payroll_provider) values ('E2E Gusto Handoff Co', 'Gusto') returning id`
  const clientId = Number(client.id)
  try {
    const [owner] = await sql`select id from users where email = 'mara@blueledgerbooks.com'`
    const stamps = [
      { type: 'day', start: '2026-08-03 09:00:00', end: '2026-08-03 17:00:00' },
      { type: 'reconciliations', start: '2026-08-03 09:00:00', end: '2026-08-03 12:00:00' },
      { type: 'lunch_unpaid', start: '2026-08-03 12:00:00', end: '2026-08-03 13:00:00' },
      { type: 'reconciliations', start: '2026-08-03 10:00:00', end: '2026-08-03 11:00:00' },
      { type: 'day', start: '2026-08-04 09:00:00', end: '2026-08-04 12:00:00' },
      { type: 'reconciliations', start: '2026-08-04 09:00:00', end: '2026-08-04 12:00:00' },
    ]
    for (const stamp of stamps) {
      await sql`insert into workstation_time_entries
        (user_id, activity_type, client_id, started_at, ended_at)
        values (${owner.id}, ${stamp.type}, ${stamp.type === 'day' || stamp.type === 'lunch_unpaid' ? null : clientId}, ${stamp.start}, ${stamp.end})`
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/clients/${clientId}`)
    await expect(page.getByTestId('gusto-payroll-panel')).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
    await expect(page.getByTestId('gusto-login-link')).toHaveAttribute('target', '_blank')
    await mkdir('test-results/payroll-handoff', { recursive: true })
    for (const [width, height, name] of [[1440, 900, 'desktop'], [768, 1024, 'tablet'], [390, 844, 'mobile']] as const) {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(150)
      await page.screenshot({ path: `test-results/payroll-handoff/${name}.png`, fullPage: true })
      const overflowing = await page.evaluate(() => Array.from(document.querySelectorAll('main *')).flatMap((element) => {
        const rect = element.getBoundingClientRect()
        return rect.right > innerWidth + 1 ? [`${element.tagName}.${element.className} right=${Math.round(rect.right)}`] : []
      }))
      expect(overflowing).toEqual([])
      const panelBounds = await page.getByTestId('gusto-payroll-panel').boundingBox()
      expect(panelBounds!.x).toBeGreaterThanOrEqual(0)
      expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(width)
    }
    await page.getByLabel('Work period start').fill('2026-08-03')
    await page.getByLabel('Work period end').fill('2026-08-09')
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('download-payroll-hours').click()
    const download = await downloadPromise
    const csv = await readFile((await download.path())!, 'utf8')
    expect(csv).toContain('Mara Ellison,2026-08-03,3.000,0.000,,,')
    expect(csv).toContain('Mara Ellison,2026-08-04,3.000,0.000,,,')
    expect(csv).not.toContain('Mara Ellison,2026-08-03,4.000')
    expect(download.suggestedFilename()).toBe('e2e-gusto-handoff-co-hours-2026-08-03-2026-08-09.csv')

    const badPeriod = await context.request.get(`/api/clients/${clientId}/payroll-hours.csv?start=2026-08-09&end=2026-08-03`)
    expect(badPeriod.status()).toBe(400)
    const anonymousContext = await apiRequest.newContext({ baseURL: baseURL ?? 'http://localhost:3200' })
    const anonymous = await anonymousContext.get(`/api/clients/${clientId}/payroll-hours.csv?start=2026-08-03&end=2026-08-09`)
    expect(anonymous.status()).toBe(401)
    await anonymousContext.dispose()
  } finally {
    await sql`delete from clients where id = ${clientId}`
  }
})


test('firm-wide worksheet includes general tracked hours and is owner/admin only', async ({ page, context, baseURL }) => {
  const storage = JSON.parse(readFileSync(OWNER_COOKIES_FILE, 'utf8'))
  await context.addCookies(storage.cookies.map((cookie: { name: string; value: string }) => ({
    name: cookie.name, value: cookie.value, url: baseURL ?? 'http://localhost:3200',
  })))
  const [staff] = await sql`insert into users (email, first_name, last_name, role, password_hash)
    values ('payroll-audit@firmos-test.local', 'Payroll', 'Audit', 'bookkeeper', 'test-fixture') returning id`
  const [entry] = await sql`insert into workstation_time_entries
    (user_id, activity_type, started_at, ended_at)
    values (${staff.id}, 'day', '2026-08-03 09:00:00', '2026-08-03 10:00:00') returning id`
  try {
    await page.goto('/reports/payroll?month=2026-08')
    await expect(page.getByTestId('payroll-row').first()).toBeVisible()
    await expect(page.getByTestId('gusto-payroll-panel')).toContainText('including general day-clock time')
    for (const [width, height, name] of [[1440, 900, 'desktop'], [768, 1024, 'tablet'], [390, 844, 'mobile']] as const) {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(150)
      await page.screenshot({ path: `test-results/payroll-handoff/firm-${name}.png`, fullPage: true })
    }
    await page.getByLabel('Work period start').fill('2026-08-03')
    await page.getByLabel('Work period end').fill('2026-08-09')
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('download-payroll-hours').click()
    const download = await downloadPromise
    const csv = await readFile((await download.path())!, 'utf8')
    expect(csv).toContain('Payroll Audit,2026-08-03,1.000,0.000,,,')
    expect(download.suggestedFilename()).toBe('firmos-hours-2026-08-03-2026-08-09.csv')

    const staffStorage = JSON.parse(readFileSync('/tmp/firmos-e2e-jorge-cookies.json', 'utf8'))
    const staffContext = await apiRequest.newContext({ baseURL: baseURL ?? 'http://localhost:3200', storageState: staffStorage })
    const denied = await staffContext.get('/api/payroll-hours.csv?start=2026-08-03&end=2026-08-09')
    expect(denied.status()).toBe(403)
    await staffContext.dispose()
  } finally {
    await sql`delete from workstation_time_entries where id = ${entry.id}`
    await sql`delete from users where id = ${staff.id}`
  }
})
