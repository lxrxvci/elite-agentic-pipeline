import { test, expect } from '@playwright/test'

const API_BASE_URL = 'http://localhost:8000/api/v1'

test.describe('login flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_BASE_URL}/auth/token`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: 'e2e-test-token', token_type: 'bearer' }),
      })
    })

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
  })

  test('user can sign in and reach the dashboard', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    await page.getByLabel('Email').fill('test@example.com')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('sign in shows an error when the token endpoint fails', async ({ page }) => {
    await page.route(`${API_BASE_URL}/auth/token`, async (route) => {
      await route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Server error', status: 500 }),
      })
    })

    await page.goto('/login')
    await page.getByLabel('Email').fill('test@example.com')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('Server error')).toBeVisible()
  })
})
