import { expect, test as base } from '@playwright/test'

import { personaContext } from './helpers'

/**
 * Live plan addendum - "Portal home + vault" (portal visual parity + Phase
 * 3B credential vault, shipped after the original suite): the portal home's
 * mini year grid and Messages section, the credentials page, and the
 * documents surface. Rides the cached client persona (the magic-link path
 * cannot complete on live - production email). The CPA journey is covered
 * by portal.spec.ts.
 *
 * Each test builds its OWN context from the cached session: the acting
 * business is an httpOnly cookie (portal_client_id), and the shared persona
 * context would leak the choice into portal.spec.ts (which sorts after this
 * file and expects the chooser).
 */

async function freshClientPage(browser: import('@playwright/test').Browser) {
  const context = await personaContext(browser, 'client')
  const page = await context.newPage()
  return { context, page }
}

/** Land on the Harborline portal home: choose it at the chooser, or switch
 *  when the session came in with another business selected. */
async function ensureHarborline(page: import('@playwright/test').Page) {
  await page.goto('/portal')
  const chooser = page.getByRole('heading', { name: 'Choose your business' })
  await expect(chooser.or(page.getByRole('heading', { name: /Hi / }))).toBeVisible({
    timeout: 30_000,
  })
  if (await chooser.isVisible()) {
    await page.getByRole('button', { name: /Harborline Marine Supply/ }).click()
  }
  await expect(page.getByRole('heading', { name: /Hi / })).toBeVisible({ timeout: 30_000 })
  const switcher = page.getByRole('button', { name: 'Switch business' })
  if (!(await switcher.textContent())?.includes('Harborline')) {
    await switcher.click()
    await page.getByRole('menuitem', { name: 'Harborline Marine Supply' }).click()
    await expect(switcher).toContainText('Harborline Marine Supply', { timeout: 15_000 })
  }
}

base.describe('portal client home extras', () => {
  base('portal home: mini year grid + Messages section render', async ({ browser }) => {
    base.setTimeout(90_000)
    const { context, page } = await freshClientPage(browser)
    try {
      await ensureHarborline(page)

      // The mini year grid (same engine truth as the staff grid).
      await expect(page.getByTestId('portal-year-progress')).toBeVisible({ timeout: 30_000 })
      expect(await page.getByTestId('portal-year-grid-cell').count()).toBeGreaterThan(0)

      // The Messages section (correspondence hub on the portal home).
      await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible()
    } finally {
      await context.close()
    }
  })

  base('portal credentials: the vault page renders (slots or honest empty state)', async ({
    browser,
  }) => {
    base.setTimeout(90_000)
    const { context, page } = await freshClientPage(browser)
    try {
      await ensureHarborline(page)

      await page.goto('/portal/credentials')
      await expect(page.getByRole('heading', { name: 'Logins', exact: true })).toBeVisible({ timeout: 15_000 })
      const panel = page.getByTestId('portal-credentials-panel')
      await expect(panel).toBeVisible()
      // Harborline predates the vault: no expected slots, no saved logins -
      // the page must say so plainly (the slot list exists once an intake with
      // "grant us login access" converts; covered staff-side in
      // client-record.spec.ts on the converted LIVE-TEST client).
      await expect(page.getByText(/Nothing saved yet|Logins we still need/i).first()).toBeVisible()
      // Secrets never render.
      const html = await panel.innerHTML()
      expect(html).not.toMatch(/password\s*[:=]\s*\S/i)
    } finally {
      await context.close()
    }
  })

  base('portal documents page loads', async ({ browser }) => {
    base.setTimeout(90_000)
    const { context, page } = await freshClientPage(browser)
    try {
      await ensureHarborline(page)

      await page.goto('/portal/documents')
      await expect(page.getByTestId('portal-upload-panel')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/Internal Server Error|Application error/)).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})
