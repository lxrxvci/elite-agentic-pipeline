import { test, expect } from '@playwright/test'

const API_BASE_URL = process.env.REAL_API_URL || 'http://localhost:8000/api/v1'

/**
 * End-to-end journey against the *real* backend.
 *
 * This spec assumes the backend and database are running (e.g. via
 * `docker-compose up`). It validates the dev auth cookie flow, the Foodcart
 * onboarding endpoint, and the public site renderer all work together.
 */

test.describe('full user journey against real backend', () => {
  test.use({ baseURL: 'http://localhost:3000' })

  test('login → onboard foodcart tenant → view published site', async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`
    const slug = `e2e-tacos-${Date.now()}`
    const businessName = 'E2E Tacos'

    // Login via the real dev auth endpoint. This creates a tenant/user and
    // sets the httpOnly elite_session cookie (plus a readable csrf_token cookie).
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // The form redirects to the marketing landing page after a successful login.
    await expect(page).toHaveURL('/', { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'You cook.' })).toBeVisible()

    // Use the session cookie to onboard a Foodcart tenant/site via the API.
    const cookies = await page.context().cookies()
    const csrfToken = cookies.find((c) => c.name === 'csrf_token')?.value

    const onboardResponse = await page.context().request.post(`${API_BASE_URL}/tenants/onboard`, {
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      data: JSON.stringify({
        business_name: businessName,
        slug,
        template_id: 'custom',
        brand_colors: {
          primary: '#6161FF',
          secondary: '#4f4fdb',
          background: '#ffffff',
        },
      }),
    })
    expect(onboardResponse.ok()).toBe(true)

    // Visit the published public site and verify the hero renders the business name.
    await page.goto(`/sites/${slug}`)
    await expect(page.getByRole('heading', { name: businessName, exact: true })).toBeVisible()
    await expect(page.getByText('Fresh food, made with love.')).toBeVisible()

    // Verify the public API directly returns the site too.
    const publicResponse = await page.context().request.get(`${API_BASE_URL}/public/sites/${slug}`)
    expect(publicResponse.ok()).toBe(true)
    const publicSite = await publicResponse.json()
    expect(publicSite.slug).toBe(slug)
    expect(publicSite.publish_state).toBe('published')
  })
})
