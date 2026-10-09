import { expect, test } from '@playwright/test'

/**
 * 10_09 prod incident: a stale better-auth.session_token cookie looped
 * /login -> / -> /login (the middleware bounced on cookie presence while the
 * guard bounced on the invalid session) - ERR_TOO_MANY_REDIRECTS. /login now
 * validates server-side: a stale cookie renders the form; a valid session
 * still skips it.
 */

test('a stale session cookie never redirect-loops /login', async ({ context, page }) => {
  await context.addCookies([
    { name: 'better-auth.session_token', value: 'stale-deadbeef', url: 'http://localhost:3200' },
  ])
  await page.goto('/login')
  // The form renders - no bounce to / and back.
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByLabel('Email')).toBeVisible()
})

test('a valid session still skips the login form', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('mara@blueledgerbooks.com')
  await page.getByLabel('Password').fill('Firm0s-dev!')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))

  await page.goto('/login')
  // Valid session: the page bounces past the form to the role's landing page.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
})
