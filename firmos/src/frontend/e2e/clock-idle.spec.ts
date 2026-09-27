import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

import { OWNER_COOKIES_FILE } from './global-setup'

/**
 * Clock-C2 return-time forgiveness, end to end: the server closed the
 * owner's session while she was away (sweep-shaped rows, planted directly -
 * waiting out the real 25-minute idle + grace window is not e2e-able), the
 * widget discovers the pending gap on load, the four-choice dialog applies
 * "Discard & continue", and the books reflect the trim + the fresh clock.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://lxrxcvi@localhost:5432/firmos'

test.beforeEach(async ({ context, baseURL }) => {
  try {
    const storage = JSON.parse(readFileSync(OWNER_COOKIES_FILE, 'utf8'))
    await context.addCookies(
      storage.cookies.map((c: { name: string; value: string }) => ({
        name: c.name,
        value: c.value,
        url: baseURL ?? 'http://localhost:3200',
      })),
    )
  } catch {
    // Sign-in unavailable in global setup; the test logs in through the UI.
    await context.newPage().then(async (page) => {
      await page.goto('/login')
      await page.getByLabel('Email').fill('mara@blueledgerbooks.com')
      await page.getByLabel('Password').fill('Firm0s-dev!')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.close()
    })
  }
})

test('idle forgiveness: closed-while-away gap opens the 4-choice dialog; discard & continue re-clocks', async ({
  page,
}) => {
  const sql = postgres(DATABASE_URL, { max: 1 })
  let fixtureEntryIds: number[] = []
  try {
    const [mara] = await sql<{ id: number }[]>`
      select id from users where email = 'mara@blueledgerbooks.com' limit 1`
    expect(mara).toBeTruthy()
    const [client] = await sql<{ id: number; legal_name: string }[]>`
      select id, legal_name from clients order by id limit 1`
    expect(client).toBeTruthy()

    // Sweep-shaped close: last activity 55 min ago, closed 30 min ago (the
    // recorded stretch = 15 timeout + 10 grace = 25 minutes, all paid).
    const now = Date.now()
    const idleStart = new Date(now - 55 * 60_000)
    const closeAt = new Date(now - 30 * 60_000)
    const startedAt = new Date(now - 3 * 60 * 60_000)
    const rows = await sql<{ id: number }[]>`
      insert into workstation_time_entries
        (user_id, activity_type, client_id, started_at, ended_at, duration_minutes, last_activity_at, auto_closed)
      values
        (${mara.id}, 'day', null, ${startedAt}, ${closeAt}, 150, ${idleStart}, true),
        (${mara.id}, 'tasks', ${client.id}, ${startedAt}, ${closeAt}, 150, ${idleStart}, true)
      returning id`
    fixtureEntryIds = rows.map((r) => r.id)

    await page.goto('/workstation')
    await expect(page.getByRole('heading', { name: 'Workstation' })).toBeVisible()

    // The widget's first poll finds the clocked-out session and the pending
    // forgiveness gap: exactly the four Toggl choices render.
    const dialog = page.getByTestId('idle-forgiveness-dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('idle-forgiveness-desc')).toContainText(
      'kept 25 min of idle time',
    )
    await expect(page.getByTestId('idle-choice-discard')).toBeVisible()
    await expect(page.getByTestId('idle-choice-discard-continue')).toBeVisible()
    await expect(page.getByTestId('idle-choice-add-entry')).toBeVisible()
    await expect(page.getByTestId('idle-choice-keep')).toBeVisible()

    await page.getByTestId('idle-choice-discard-continue').click()

    // The widget re-clocks (fresh day + same client/kind restarted).
    await expect(page.getByTestId('clock-widget')).toHaveAttribute('data-state', 'in', {
      timeout: 15_000,
    })
    await expect(dialog).toHaveCount(0)

    // Server truth: the recorded rows trimmed back to the idle start, a
    // fresh day session is open, and the gap is resolved (never re-offered).
    const trimmed = await sql<{ ended_at: Date }[]>`
      select ended_at from workstation_time_entries where id = any(${fixtureEntryIds})`
    expect(trimmed.map((r) => r.ended_at.getTime())).toEqual([
      idleStart.getTime(),
      idleStart.getTime(),
    ])
    const openDay = await sql<{ id: number }[]>`
      select id from workstation_time_entries
      where user_id = ${mara.id} and activity_type = 'day' and ended_at is null`
    expect(openDay).toHaveLength(1)
    const resolved = await sql<{ id: number }[]>`
      select id from audit_events
      where action = 'idle_time_resolved' and entity_id = any(${fixtureEntryIds})`
    expect(resolved.length).toBeGreaterThan(0)

    // Tidy: sign the fresh session back out through the widget so the dev
    // database stays clocked-out for the next suite. The first clocked-in
    // state opens the one-time IdleDetector explainer (Chromium) - decline
    // it first, its overlay swallows the widget click otherwise.
    const explainer = page.getByTestId('idle-explainer-dialog')
    if (await explainer.isVisible().catch(() => false)) {
      await page.getByTestId('idle-explainer-decline').click()
      await expect(explainer).toHaveCount(0)
    }
    await page.getByTestId('clock-client').click()
    await page.getByRole('menuitem', { name: /^clock out$/i }).click()
    await expect(page.getByTestId('clock-widget')).toHaveAttribute('data-state', 'out', {
      timeout: 15_000,
    })
  } finally {
    await sql`
      delete from audit_events
      where action = 'idle_time_resolved' and entity_id = any(${fixtureEntryIds})`
    await sql`delete from workstation_time_entries where id = any(${fixtureEntryIds})`
    await sql.end()
  }
})
