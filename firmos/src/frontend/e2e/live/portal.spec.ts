import { expect, test as unsignedTest } from '@playwright/test'

import { liveName, live } from './helpers'

/**
 * Live plan - "Portal (client and CPA)". The magic-link path cannot complete
 * on live (email driver), so portal journeys ride the shared persona
 * contexts (credentials sign-in via the API, cached once per persona); the
 * UI credentials login for a portal user is covered in auth.spec. No
 * dev-links helper anywhere in this file.
 */

unsignedTest('portal: login page renders for signed-out visitors', async ({ page }) => {
  await page.goto('/portal/login')
  await expect(
    page.getByRole('button', { name: 'Email me a sign-in link' }),
  ).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
})

live.describe('portal client', () => {
  live.use({ persona: 'client' })

  live('choose business, surfaces, request, chat', async ({ page }) => {
    live.setTimeout(120_000)
    await page.goto('/portal')

    // ── Choose a business (alison is linked to three) ──
    await expect(page.getByRole('heading', { name: 'Choose your business' })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: /Blue Spruce Landscaping/ }).click()

    // ── Waiting on you: the seeded parked bank feed ──
    await expect(page.getByRole('heading', { name: 'Waiting on you' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('waiting-on-you-item').first()).toBeVisible()

    // Blue Spruce cannot upload: documents shows the disabled note, no input.
    await page.goto('/portal/documents')
    await expect(page.getByTestId('portal-upload-disabled')).toBeVisible({ timeout: 15_000 })
    expect(await page.locator('input[type=file]').count()).toBe(0)

    // ── Switch to Harborline (uploads + messaging enabled) ──
    await page.getByRole('button', { name: 'Switch business' }).click()
    await page.getByRole('menuitem', { name: 'Harborline Marine Supply' }).click()
    await expect(page.getByRole('button', { name: 'Switch business' })).toContainText(
      'Harborline Marine Supply',
      { timeout: 15_000 },
    )

    await page.goto('/portal/documents')
    await expect(page.getByTestId('portal-upload-panel')).toBeVisible({ timeout: 15_000 })

    await page.goto('/portal/statements')
    await expect(page.getByRole('heading', { name: 'Statements' })).toBeVisible({
      timeout: 15_000,
    })

    await page.goto('/portal/reports')
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 15_000 })

    // ── Requests: create one (LIVE-TEST details) and see the list grow ──
    await page.goto('/portal/requests')
    const requestText = liveName('request')
    const cardsBefore = await page.getByTestId('portal-request-card').count()
    await page.getByLabel('Details').fill(requestText)
    await page.getByRole('button', { name: 'Send request' }).click()
    // The server titles requests "Document request from <client>"; the
    // confirmation echoes it and history gains a card.
    await expect(page.getByText(/Sent: Document request from/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('portal-request-card')).toHaveCount(cardsBefore + 1, {
      timeout: 15_000,
    })

    // ── Profile renders direct-edit plus approval-request fields ──
    await page.goto('/portal/profile')
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Business settings' })).toBeVisible()

    // ── Invoices: read-only list (rows or the explicit empty state) ──
    await page.goto('/portal/invoices')
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 15_000 })
    const invoiceRows = page.getByTestId('portal-invoice-row')
    const noInvoices = page.getByText('No invoices yet')
    expect((await invoiceRows.count()) + (await noInvoices.count())).toBeGreaterThan(0)

    // ── Chat: text-only send; no attachment affordance exists ──
    await page.goto('/portal/chat')
    await expect(page.getByRole('heading', { name: 'Chat' })).toBeVisible({ timeout: 15_000 })
    expect(await page.locator('input[type=file]').count()).toBe(0)
    const chatText = liveName('chat hello, please ignore')
    await page.getByRole('textbox', { name: 'Message' }).fill(chatText)
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByText(chatText)).toBeVisible({ timeout: 15_000 })

    // ── Properties: switch to the real-estate client ──
    await page.getByRole('button', { name: 'Switch business' }).click()
    await page.getByRole('menuitem', { name: 'Riverstone Property Group' }).click()
    await expect(page.getByRole('button', { name: 'Switch business' })).toContainText(
      'Riverstone Property Group',
      { timeout: 15_000 },
    )
    await page.goto('/portal/properties')
    await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId('portal-proforma-card').first()).toBeVisible({
      timeout: 15_000,
    })
  })
})

live.describe('portal cpa', () => {
  live.use({ persona: 'cpa' })

  live('scoped client list, read-only detail, foreign id 404', async ({ page }) => {
    live.setTimeout(90_000)
    await page.goto('/portal')

    // CPA home redirects to the linked client list.
    await page.waitForURL((url) => url.pathname === '/portal/cpa', { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Your clients' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText('Harborline Marine Supply')).toBeVisible()
    await expect(page.getByText('Copperline Coffee Roasters')).toBeVisible()
    // Blue Spruce is NOT linked to carlos - it must not appear.
    await expect(page.getByText('Blue Spruce Landscaping')).toHaveCount(0)

    // Harborline detail: reports, read-only statements, tax docs; no uploads.
    await page.getByRole('link', { name: /Harborline Marine Supply/ }).click()
    await expect(page.getByRole('heading', { name: 'Harborline Marine Supply' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Statements' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tax documents' })).toBeVisible()
    await expect(page.getByText('Statements are read-only for CPA sign-ins.')).toBeVisible()
    expect(await page.locator('input[type=file]').count()).toBe(0)

    // A client id outside the linked set answers 404, not 403.
    const response = await page.goto('/portal/cpa/999999')
    expect(response?.status()).toBe(404)
    await expect(page.getByText(/404|not found/i).first()).toBeVisible()
  })
})
