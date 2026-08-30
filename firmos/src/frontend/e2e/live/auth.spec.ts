import { expect, test } from '@playwright/test'

import { LIVE_PASSWORD, PORTAL, STAFF, loginAs, logout } from './helpers'

/**
 * Live plan - "Auth and isolation". Credentials only: no dev-links, no
 * magic-link helper (both are disabled under NODE_ENV=production).
 * Lockout and TOTP enroll are deliberately out of scope here: lockout
 * requires a throwaway account plus a DB unlock (no admin unlock surface),
 * and TOTP confirmation mutates the account; both are covered locally by
 * the server test suite.
 */
test.describe('auth', () => {
  test('staff login happy path and logout', async ({ page }) => {
    await loginAs(page, STAFF.owner)
    // Owner lands on the Firm Progression Board (role-based landing).
    await expect(page).toHaveURL(/\/progress$/)
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible()

    await logout(page)
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

    // The session is really gone: a protected route bounces back to /login.
    await page.goto('/workstation')
    await page.waitForURL((url) => url.pathname === '/login')
  })

  test('wrong password shows the generic error, no account enumeration', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(STAFF.owner)
    await page.getByLabel('Password').fill('definitely-not-the-password-1Z')
    await page.getByRole('button', { name: 'Sign in' }).click()
    // The Next.js route announcer also has role=alert; match the form text.
    await expect(page.getByText('Invalid email or password.')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('signed-out users are redirected to /login with next preserved', async ({ page }) => {
    await page.goto('/workstation')
    await page.waitForURL((url) => url.pathname === '/login')
    expect(new URL(page.url()).searchParams.get('next')).toBe('/workstation')
  })

  test('portal user hitting a staff route is redirected to /portal', async ({ page }) => {
    // Portal users CAN authenticate through the staff login form (same
    // credential backend); the (app) layout then bounces them to /portal.
    await loginAs(page, PORTAL.client)
    await page.waitForURL((url) => url.pathname.startsWith('/portal'), { timeout: 30_000 })

    await page.goto('/workstation')
    await page.waitForURL((url) => url.pathname.startsWith('/portal'), { timeout: 30_000 })
  })

  test('staff hitting /portal get a 404', async ({ page }) => {
    await loginAs(page, STAFF.owner)
    await expect(page).toHaveURL(/\/$/)

    const response = await page.goto('/portal')
    expect(response?.status()).toBe(404)
  })
})
