import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { OWNER_COOKIES_FILE } from './global-setup'

/**
 * Credential vault, end to end (Phase 3B):
 *  1. CLIENT (portal dev server, 3201): alison fills the conversion-seeded
 *     "Chase operating checking" slot with a real login; it moves to Saved
 *     logins, always masked.
 *  2. STAFF (production server, 3200, owner session): the same row reads
 *     Saved on the client's Credentials tab; Copy password hands the real
 *     secret to the clipboard with the audit toast, and the access log
 *     records the copy. The page itself never contains the secret.
 * Both servers share the throwaway e2e vault key (e2e/vault-key.ts).
 */

const ALISON = 'alison@harborlinemarine.com'
const E2E_SECRET = 'E2E-chase-login-secret-9182'

const PORTAL_BASE_URL = 'http://localhost:3201'
const STAFF_BASE_URL = 'http://localhost:3200'

test.describe.serial('credential vault (3B)', () => {
  test.describe.configure({ timeout: 180_000 })

  test('client fills an expected slot in the portal; staff copy is audited end to end', async ({
    browser,
  }) => {
    // ── 1. Portal self-entry (dev server, real HTTP server action) ──
    // Portal users sign in by magic link (§12), never by password - and the
    // dev-links helper serves the link without a mailbox. (Password sign-in
    // would also be invalid here whenever portal.spec's magic-link journey
    // ran first: Better Auth's account linking drops the portal user's
    // credential row on verify - a pre-existing auth quirk, not vault code.)
    const portalCtx = await browser.newContext({ baseURL: PORTAL_BASE_URL })
    const portalPage = await portalCtx.newPage()
    await portalPage.goto('/portal/login')
    await portalPage.getByLabel('Email').fill(ALISON)
    await portalPage.getByRole('button', { name: 'Email me a sign-in link' }).click()
    const devLink = portalPage.getByTestId('dev-magic-link').getByRole('link')
    await expect(devLink).toBeVisible()
    const magicUrl = await devLink.getAttribute('href')
    expect(magicUrl).toBeTruthy()
    await portalPage.goto(magicUrl!)
    await portalPage.waitForURL((url) => url.pathname.startsWith('/portal'), { timeout: 30_000 })

    // Multi-business accounts land on the picker first; wait for the home
    // surface so the acting-client cookie is written before navigating.
    const choose = portalPage.getByRole('button', { name: /Harborline Marine Supply/ })
    await choose.waitFor()
    await choose.click()
    await expect(
      portalPage.getByRole('heading', { name: /Waiting on you|Where your books stand/ }).first(),
    ).toBeVisible()

    await portalPage.goto('/portal/credentials')
    await expect(portalPage.getByTestId('portal-credentials-panel')).toBeVisible()

    // The seeded expected slot is itemized for the client.
    const slot = portalPage.getByTestId('portal-credentials-panel').getByText('Chase operating checking')
    await expect(slot).toBeVisible()
    await portalPage.getByRole('button', { name: 'Add login' }).first().click()

    await portalPage.getByLabel('Username').fill('alison-brewer')
    await portalPage.getByLabel('Password').fill(E2E_SECRET)
    await portalPage.getByTestId('save-credential').click()
    await expect(portalPage.getByRole('dialog')).toBeHidden({ timeout: 15_000 })

    // Saved and masked: the secret never renders anywhere on the page.
    await expect(
      portalPage.getByTestId('portal-credentials-panel').getByText('Chase operating checking'),
    ).toBeVisible()
    await expect(portalPage.getByText(/Password: •+/).first()).toBeVisible()
    await expect(portalPage.getByText(E2E_SECRET)).toHaveCount(0)
    await portalCtx.close()

    // ── 2. Staff copy-on-use (production server, owner session) ──
    const staffCtx = await browser.newContext({
      baseURL: STAFF_BASE_URL,
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    const storage = JSON.parse(readFileSync(OWNER_COOKIES_FILE, 'utf8'))
    await staffCtx.addCookies(
      storage.cookies.map((c: { name: string; value: string }) => ({
        name: c.name,
        value: c.value,
        url: STAFF_BASE_URL,
      })),
    )
    const staffPage = await staffCtx.newPage()

    await staffPage.goto('/clients')
    await staffPage.getByTestId('client-row').filter({ hasText: 'Harborline Marine Supply' }).first().click()
    await staffPage.waitForURL((url) => /^\/clients\/\d+$/.test(url.pathname))
    const clientUrl = staffPage.url()
    await staffPage.goto(`${clientUrl}?tab=credentials`)

    const panel = staffPage.getByTestId('client-credentials-panel')
    await expect(panel).toBeVisible()
    const chaseRow = panel.locator('li', { hasText: 'Chase operating checking' })
    await expect(chaseRow.getByText('Saved')).toBeVisible()
    await expect(chaseRow.getByText('User: alison-brewer')).toBeVisible()

    // Copy password: the secret lands on the clipboard, the toast says it's logged.
    await chaseRow.getByRole('button', { name: 'Copy password' }).click()
    await expect(staffPage.getByText('Copied — logged for audit')).toBeVisible({ timeout: 15_000 })
    const clipboard = await staffPage.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(E2E_SECRET)
    // The page itself never carries the secret.
    await expect(staffPage.getByText(E2E_SECRET)).toHaveCount(0)

    // The access log inside Details records the copy (and the dialog open
    // itself is the audited viewed_username event).
    await chaseRow.getByRole('button', { name: /Details for/ }).click()
    const accessLog = staffPage.getByTestId('credential-access-log')
    await expect(accessLog).toBeVisible({ timeout: 15_000 })
    await expect(accessLog.getByText(/Password copied/)).toBeVisible()
    await expect(accessLog.getByText(/Details viewed/)).toBeVisible()
    await staffCtx.close()
  })
})
