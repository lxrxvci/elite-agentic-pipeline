import { test, expect } from '@playwright/test'

const API_BASE_URL = 'http://localhost:8000/api/v1'

// Tiny 1x1 transparent PNG used as the uploaded photo fixture.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function pngFilePayload() {
  const buffer = Buffer.from(PNG_BASE64, 'base64')
  return {
    name: 'foodcart.png',
    mimeType: 'image/png',
    buffer,
  }
}

test.describe('photo-driven onboarding flow', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as an owner so the onboarding wizard can load.
    await page.goto('/admin/login')
    await page.evaluate(() => localStorage.setItem('__fc_clerk_token', 'e2e-token'))

    // Mock core backend endpoints.
    await page.route(`${API_BASE_URL}/tenants/me`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'tenant-photo',
          name: 'Photo Cart',
          slug: 'photo-cart',
          status: 'active',
          billing_status: 'trial',
          created_at: '',
          updated_at: '',
        }),
      })
    })

    await page.route(`${API_BASE_URL}/tenants/slug/check`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'photo-cart', available: true }),
      })
    })

    await page.route(`${API_BASE_URL}/uploads/presigned`, async (route) => {
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_url: 'https://r2-mock.example.com/upload',
          fields: { key: 'photo-cart/image.png' },
          storage_key: 'photo-cart/image.png',
          public_url: 'https://cdn-mock.example.com/photo-cart/image.png',
          image_id: 'image-photo-001',
          expires_in: 300,
        }),
      })
    })

    // Mock the direct R2 upload POST so no real storage is used.
    await page.route('https://r2-mock.example.com/upload', async (route) => {
      await route.fulfill({ status: 204 })
    })

    await page.route(`${API_BASE_URL}/tenants/onboard`, async (route) => {
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant: {
            id: 'tenant-photo',
            name: 'Photo Cart',
            slug: 'photo-cart',
            status: 'active',
            billing_status: 'trial',
            created_at: '',
            updated_at: '',
          },
          site: {
            id: 'site-photo-001',
            tenant_id: 'tenant-photo',
            slug: 'photo-cart',
            template_id: 'custom',
            publish_state: 'published',
            created_at: '',
            updated_at: '',
          },
        }),
      })
    })

    await page.route(`${API_BASE_URL}/sites`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            id: 'site-photo-001',
            tenant_id: 'tenant-photo',
            slug: 'photo-cart',
            template_id: 'custom',
            publish_state: 'published',
            created_at: '',
            updated_at: '',
          },
        ]),
      })
    })
  })

  test('uploads a photo during onboarding and completes publish', async ({ page }) => {
    await page.goto('/admin/onboarding')
    await page.getByTestId('onboarding-wizard').waitFor()

    // Identity step
    await page.locator('input#business-name').fill('Photo Cart')
    await page.locator('input#slug').fill('photo-cart')
    await expect(page.getByText('photo-cart is available')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    // Photo step (flag is enabled via NEXT_PUBLIC_ENABLED_FEATURES).
    await expect(page.getByText('Snap or upload a photo')).toBeVisible()
    await page.getByTestId('photo-file-input').setInputFiles(pngFilePayload())
    await expect(page.getByText('Photo uploaded successfully.')).toBeVisible()
    await expect(page.locator('img[alt="Preview of your food cart"]')).toBeVisible()

    await page.getByRole('button', { name: 'Next' }).click()

    // Links step
    await expect(page.getByText('Google Business Profile')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    // Brand step
    await expect(page.getByLabel('Primary brand color')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    // Preview & publish
    await expect(page.getByText('Ready to publish')).toBeVisible()
    await expect(page.getByText('Photo Cart will be live at')).toBeVisible()
    await page.getByRole('button', { name: 'Publish now' }).click()

    // Success: redirect to dashboard with site preview.
    await page.waitForURL('/admin/dashboard')
    await expect(page.getByRole('heading', { name: 'Site overview' })).toBeVisible()
    await expect(page.getByText('photo-cart.webagentic.app')).toBeVisible()
  })
})
