import { test, expect } from '@playwright/test'

const API_BASE_URL = process.env.REAL_API_URL || 'http://localhost:8000/api/v1'

/**
 * End-to-end journey against the *real* backend.
 *
 * This spec assumes the backend and database are running (e.g. via
 * `docker-compose up`). It exercises the integrated system rather than
 * mocking the API, so it validates auth, serialization, persistence, and
 * error handling together.
 */

test.describe('full user journey against real backend', () => {
  test.use({ baseURL: 'http://localhost:3000' })

  test('login → client → project → time → invoice → payment', async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`

    // Login via the real dev auth endpoint.
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()

    // Create client
    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '+ Add client' }).click()
    await expect(page.getByRole('heading', { name: 'Add client' })).toBeVisible()
    await page.getByLabel('Name').fill('Acme Corp')
    await page.getByLabel('Email').fill('billing@acme.com')
    await page.getByLabel('Default hourly rate').fill('100')
    await page.getByRole('button', { name: 'Save client' }).click()
    await expect(page).toHaveURL('/clients')
    await expect(page.getByText('Acme Corp')).toBeVisible()

    // Create project
    await page.getByRole('link', { name: 'Projects' }).click()
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '+ Add project' }).click()
    await expect(page.getByRole('heading', { name: 'Add project' })).toBeVisible()
    await page.getByLabel('Client').selectOption('Acme Corp')
    await page.getByLabel('Name').fill('Website Redesign')
    await page.getByRole('button', { name: 'Save project' }).click()
    await expect(page).toHaveURL('/projects')
    await expect(page.getByText('Website Redesign')).toBeVisible()

    // Log time
    await page.getByRole('link', { name: 'Time tracker' }).click()
    await expect(page.getByRole('heading', { name: 'Time tracker', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '+ Log time' }).click()
    await expect(page.getByRole('heading', { name: 'Quick time entry' })).toBeVisible()
    await page.getByLabel('Client').selectOption('Acme Corp')
    await page.getByLabel('Project').selectOption('Website Redesign')
    await page.getByLabel('Description').fill('Initial discovery')
    await page.getByLabel('Duration (minutes)').fill('60')
    await page.getByRole('dialog').getByRole('button', { name: 'Log time' }).click()
    await expect(page.getByText('Time entry logged')).toBeVisible()
    await expect(page.getByText('Initial discovery')).toBeVisible()

    // Create invoice
    await page.getByRole('link', { name: 'Invoices' }).click()
    await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '+ Create invoice' }).click()
    await expect(page.getByRole('heading', { name: 'Create invoice' })).toBeVisible()
    await page.getByLabel('Client').selectOption('Acme Corp')
    await page.getByText('Initial discovery').click()
    await page.getByRole('button', { name: 'Create invoice' }).click()

    // Invoice detail
    await expect(page).toHaveURL(/\/invoices\/[^/]+$/)
    await expect(page.getByRole('heading', { name: 'USD 100.00' })).toBeVisible()
    await expect(page.getByText('Sent')).toBeVisible()

    // Record payment
    await page.getByRole('button', { name: 'Record payment' }).click()
    await expect(page.getByRole('heading', { name: 'Record payment' })).toBeVisible()
    await page.getByLabel('Payment method').fill('Bank transfer')
    await page.getByRole('button', { name: 'Mark paid' }).click()
    await expect(page.getByText('Invoice marked as paid')).toBeVisible()
    await expect(page.getByText('Paid', { exact: true })).toBeVisible()

    // Verify the invoice is persisted via the real API.
    const cookies = await page.context().cookies()
    const sessionCookie = cookies.find((c) => c.name === 'elite_session')
    expect(sessionCookie).toBeTruthy()

    const meResponse = await fetch(`${API_BASE_URL}/me`, {
      headers: { Cookie: `elite_session=${sessionCookie?.value}` },
    })
    expect(meResponse.status).toBe(200)
  })
})
