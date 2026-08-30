import { expect, test } from '@playwright/test'

/**
 * The client/CPA portal, end to end (HANDOFF §12):
 *
 *  1. client magic link: request a link as alison (dev-links helper serves
 *     it back without a mailbox) -> verify -> land in the portal -> choose
 *     a business -> waiting-on-you renders -> upload a receipt -> it
 *     appears in Documents and downloads through the scoped API route.
 *  2. CPA: carlos signs in -> client list -> Harborline detail renders
 *     reports + read-only statements grid, offers no upload affordances,
 *     and cannot download a client receipt (folder-prefix scope).
 *  3. route protection both directions: staff hitting /portal get 404.
 */

const ALISON = 'alison@harborlinemarine.com'
const CARLOS = 'carlos@riverstonetax.com'
const PASSWORD = 'Firm0s-dev!'

// The portal spec runs against the dev web server (playwright.config.ts
// PORTAL_PORT): the magic-link flow needs the dev email driver and the
// dev-links helper, both disabled under NODE_ENV=production.
test.use({ baseURL: 'http://localhost:3201' })

/** Smallest file that passes the layered upload validation (%PDF magic). */
const RECEIPT_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

/** Sign in with seed credentials (fine for tests; the magic-link path is covered separately). */
async function credentialsSignIn(page: import('@playwright/test').Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname.startsWith('/portal'), { timeout: 30_000 })
}

test.describe.serial('portal', () => {
  // The dev web server compiles routes on first hit; give the magic-link
  // and CPA journeys room.
  test.describe.configure({ timeout: 180_000 })

  let receiptDocumentId: string

  test('client: magic link -> choose business -> waiting on you -> upload receipt', async ({
    page,
  }) => {
    // ── Request a magic link ──
    await page.goto('/portal/login')
    await page.getByLabel('Email').fill(ALISON)
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
    await expect(page.getByText('Check your email')).toBeVisible()

    // Dev-only: the same link the email carried, served by the dev-links helper.
    const devLink = page.getByTestId('dev-magic-link').getByRole('link')
    await expect(devLink).toBeVisible()
    const magicUrl = await devLink.getAttribute('href')
    expect(magicUrl).toBeTruthy()

    // ── Verify -> land in the portal ──
    await page.goto(magicUrl!)
    await page.waitForURL((url) => url.pathname === '/portal', { timeout: 30_000 })

    // ── Choose a business (no acting selection yet) ──
    await expect(page.getByRole('heading', { name: 'Choose your business' })).toBeVisible()
    await page.getByRole('button', { name: /Blue Spruce Landscaping/ }).click()

    // ── Waiting on you renders the seeded parked bank feed ──
    await expect(page.getByRole('heading', { name: 'Waiting on you' })).toBeVisible()
    const waitingItem = page.getByTestId('waiting-on-you-item').first()
    await expect(
      waitingItem.getByText('Waiting on July bank statements from the client.'),
    ).toBeVisible()
    // Wave 4: kind identity chip (type color + label) on the waiting card.
    await expect(waitingItem).toHaveAttribute('data-kind', /bank_feed|reconciliation/)

    // Wave 4: the client's own year grid, same cell language as staff.
    await expect(page.getByRole('heading', { name: 'Where your books stand' })).toBeVisible()
    await expect(page.getByTestId('portal-year-progress')).toBeVisible()
    // Blue Spruce has can_view_tasks off: no tasks stream row.
    await expect(
      page.getByTestId('portal-year-progress').locator('[data-stream="tasks"]'),
    ).toHaveCount(0)

    // Blue Spruce has can_upload_docs off: no upload affordance anywhere.
    await page.goto('/portal/documents')
    await expect(page.getByTestId('portal-upload-disabled')).toBeVisible()
    expect(await page.locator('input[type=file]').count()).toBe(0)

    // ── Switch to Harborline (uploads allowed) ──
    await page.getByRole('button', { name: 'Switch business' }).click()
    await page.getByRole('menuitem', { name: 'Harborline Marine Supply' }).click()
    await expect(page.getByRole('button', { name: 'Switch business' })).toContainText(
      'Harborline Marine Supply',
    )

    // Harborline has nothing parked on the client: the celebration state.
    await page.goto('/portal')
    await expect(page.getByText("You're all caught up")).toBeVisible()
    // Harborline has can_view_tasks on: the grid shows all four streams.
    await expect(
      page.getByTestId('portal-year-progress').locator('[data-stream="tasks"]').first(),
    ).toBeVisible()

    // ── Upload a receipt ──
    await page.goto('/portal/documents')
    await expect(page.getByTestId('portal-upload-panel')).toBeVisible()
    await page.locator('#portal-upload-file').setInputFiles({
      name: 'e2e-receipt.pdf',
      mimeType: 'application/pdf',
      buffer: RECEIPT_PDF,
    })
    await page.getByRole('button', { name: 'Upload' }).click()

    // It appears in the Receipts group with a download link.
    const download = page.getByRole('link', { name: 'Download e2e-receipt.pdf' })
    await expect(download).toBeVisible({ timeout: 15_000 })
    const href = await download.getAttribute('href')
    expect(href).toMatch(/^\/api\/documents\/\d+$/)
    receiptDocumentId = href!.split('/').pop()!

    // The uploader can fetch it back through the scoped route.
    const ownDownload = await page.request.get(href!)
    expect(ownDownload.status()).toBe(200)
    expect(ownDownload.headers()['content-type']).toBe('application/pdf')

    // The upload minted a review task, which surfaces on Requests history
    // as an ad-hoc task... the request list itself is request-titled only,
    // so assert the upload is also reflected on the home summary.
    await page.goto('/portal')
    await expect(page.getByText('e2e-receipt.pdf')).toBeVisible()
  })

  test('cpa: client list -> Harborline detail, read-only, folder-scoped downloads', async ({
    page,
  }) => {
    await credentialsSignIn(page, CARLOS, '/portal')

    // CPA home redirects to the client list.
    await page.waitForURL((url) => url.pathname === '/portal/cpa', { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Your clients' })).toBeVisible()
    await expect(page.getByText('Copperline Coffee Roasters')).toBeVisible()

    await page.getByRole('link', { name: /Harborline Marine Supply/ }).click()
    await expect(page.getByRole('heading', { name: 'Harborline Marine Supply' })).toBeVisible()

    // Reports, read-only statements grid, tax documents, and the three writes.
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Statements' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tax documents' })).toBeVisible()
    await expect(page.getByText('Statements are read-only for CPA sign-ins.')).toBeVisible()
    await expect(page.getByText('Request a profile change')).toBeVisible()
    await expect(page.getByText('Request a tax document')).toBeVisible()
    await expect(page.getByText('Request from the team')).toBeVisible()

    // No upload affordances anywhere on the CPA surface.
    expect(await page.locator('input[type=file]').count()).toBe(0)
    expect(await page.locator('[data-testid^="statement-cell-"]').count()).toBe(0)

    // Folder-prefix scope: the receipt alison uploaded to a linked client
    // is still off-limits to the CPA (receipts are not tax/statement paths).
    const cpaDownload = await page.request.get(`/api/documents/${receiptDocumentId}`)
    expect(cpaDownload.status()).toBe(403)

    // A client id outside the linked set answers 404, not 403.
    await page.goto('/portal/cpa/999999')
    await expect(page.getByText(/404|not found/i).first()).toBeVisible()
  })

  test('route protection: staff hitting /portal get 404', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('mara@blueledgerbooks.com')
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((url) => url.pathname === '/')

    const response = await page.goto('/portal')
    expect(response?.status()).toBe(404)
  })
})
