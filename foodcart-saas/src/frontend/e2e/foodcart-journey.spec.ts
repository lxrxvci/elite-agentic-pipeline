import { test, expect } from '@playwright/test'

test.describe('Foodcart onboarding → publish → view site', () => {
  test('completes onboarding and renders a live site', async ({ page }) => {
    // Intercept backend calls
    await page.route('**/api/v1/tenants/me', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ id: 't1', name: 'Taco Cart', slug: 'taco-cart', status: 'active', billing_status: 'trial', created_at: '', updated_at: '' }),
      })
    })
    await page.route('**/api/v1/tenants/slug/check', async (route) => {
      await route.fulfill({ status: 200, body: JSON.stringify({ slug: 'taco-cart', available: true }) })
    })
    await page.route('**/api/v1/sites', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify([{ id: 's1', tenant_id: 't1', slug: 'taco-cart', template_id: 'banhmi', publish_state: 'published', created_at: '', updated_at: '' }]),
      })
    })
    await page.route('**/api/v1/tenants/onboard', async (route) => {
      await route.fulfill({
        status: 201,
        body: JSON.stringify({
          tenant: { id: 't1', name: 'Taco Cart', slug: 'taco-cart', status: 'active', billing_status: 'trial', created_at: '', updated_at: '' },
          site: { id: 's1', tenant_id: 't1', slug: 'taco-cart', template_id: 'banhmi', publish_state: 'published', created_at: '', updated_at: '' },
        }),
      })
    })
    await page.route('**/api/v1/public/sites/taco-cart', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          slug: 'taco-cart',
          template_id: 'banhmi',
          publish_state: 'published',
          blocks: [
            { id: 'h', site_id: 's1', tenant_id: 't1', block_type: 'hero', schema_version: '1', sort_order: 0, data: { headline: 'Taco Cart' }, created_at: '', updated_at: '' },
            { id: 'f', site_id: 's1', tenant_id: 't1', block_type: 'footer', schema_version: '1', sort_order: 1, data: { social_links: [] }, created_at: '', updated_at: '' },
          ],
        }),
      })
    })

    // Seed auth token and start onboarding
    await page.goto('/admin/login')
    await page.evaluate(() => localStorage.setItem('__fc_clerk_token', 'e2e-token'))
    await page.goto('/admin/onboarding')
    await page.getByTestId('onboarding-wizard').waitFor()

    await page.locator('input#business-name').fill('Taco Cart')
    await page.locator('input#slug').fill('taco-cart')
    await page.getByRole('button', { name: 'Next' }).click()

    // Links step
    await expect(page.getByText('Google Business Profile')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    // Template step
    await page.getByText('Banh Mi Fusion').click()
    await page.getByRole('button', { name: 'Next' }).click()

    // Preview & publish
    await expect(page.getByText('Ready to publish')).toBeVisible()
    await page.getByRole('button', { name: 'Publish now' }).click()

    // Redirect to dashboard
    await page.waitForURL('/admin/dashboard')
    await expect(page.getByText('taco-cart.foodcartsite.com')).toBeVisible()

    // View live site
    await page.goto('/sites/taco-cart')
    await expect(page.getByText('Taco Cart')).toBeVisible()
  })
})
