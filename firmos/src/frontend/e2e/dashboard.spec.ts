import { test, expect } from '@playwright/test'

const API_BASE_URL = 'http://localhost:8000/api/v1'

function paginated<T>(items: T[]) {
  return { items, total: items.length }
}

test.describe('dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_BASE_URL}/me`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'user_e2e',
          email: 'test@example.com',
          name: 'E2E User',
        }),
      })
    })

    await page.route(`${API_BASE_URL}/clients?limit=100&offset=0`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paginated([])),
      })
    })

    await page.route(`${API_BASE_URL}/projects?limit=100&offset=0`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paginated([])),
      })
    })

    await page.route(/\/time-entries.*status=unbilled/, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paginated([])),
      })
    })
  })

  test('renders dashboard for an authenticated user', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByText('No unbilled time yet')).toBeVisible()
  })
})
