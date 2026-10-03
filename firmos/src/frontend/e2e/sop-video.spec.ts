import { expect, test, type Page } from '@playwright/test'

/**
 * K2 (meeting 09_30, 01:16:00): the in-house SOP video recorder, end to end.
 * Login -> SOP admin -> new SOP -> Record SOP -> the dialog captures a
 * (faked) screen via the real MediaRecorder pipeline -> preview -> upload
 * through the local route -> the row registers -> the video plays back over
 * /api/sop-videos/[id] with the session cookie.
 *
 * getDisplayMedia can't be granted headlessly, so an init script swaps it
 * for an animated canvas capture - every step AFTER the grant (mixing,
 * MediaRecorder encoding, chunking, upload, registration, streaming) runs
 * the production code path.
 */

const SOP_TITLE = 'E2E WEX close steps'

async function loginAsOwner(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('mara@blueledgerbooks.com')
  await page.getByLabel('Password').fill('Firm0s-dev!')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/')
}

async function fakeScreenCapture(page: Page) {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')!
    setInterval(() => {
      ctx.fillStyle = `hsl(${Math.floor(Date.now() / 20) % 360} 60% 50%)`
      ctx.fillRect(0, 0, 640, 360)
      ctx.fillStyle = '#fff'
      ctx.font = '28px sans-serif'
      ctx.fillText('E2E SOP capture', 40, 60)
    }, 100)
    ;(navigator.mediaDevices as any).getDisplayMedia = async () =>
      (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(5)
    ;(navigator.mediaDevices as any).getUserMedia = async () => {
      throw new Error('no mic in e2e')
    }
  })
}

test('sop video: record in-app -> upload -> registers -> streams back', async ({ page }) => {
  await fakeScreenCapture(page)
  await loginAsOwner(page)

  // ── Create the SOP via the admin UI ──
  await page.goto('/admin/templates/sops')
  await page.getByRole('button', { name: /New SOP/ }).click()
  await page.getByLabel('Title').fill(SOP_TITLE)
  await page.getByLabel('Content').fill('1. Download the WEX statement\n2. Code fuel by vehicle')
  await page.getByRole('button', { name: 'Create SOP' }).click()
  const row = page.getByTestId('sop-row').filter({ hasText: SOP_TITLE })
  await expect(row).toBeVisible()

  // ── Record SOP: the dialog captures, previews, uploads, registers ──
  await row.getByRole('button', { name: 'Record SOP' }).click()
  await expect(page.getByTestId('sop-recorder-dialog')).toBeVisible()
  await page.getByTestId('sop-video-title').fill('WEX portal walkthrough')
  await page.getByTestId('sop-record-start').click()
  await expect(page.getByTestId('sop-record-elapsed')).toBeVisible()
  // Let a couple of real MediaRecorder chunks land.
  await page.waitForTimeout(2200)
  await expect(page.getByTestId('sop-record-elapsed')).toHaveText(/00:0[12]/)
  await page.getByTestId('sop-record-stop').click()

  await expect(page.getByTestId('sop-record-preview')).toBeVisible()
  await page.getByTestId('sop-record-use').click()
  await expect(page.getByText('The walkthrough is on the SOP.')).toBeVisible({ timeout: 15_000 })

  // ── The row now carries one video; the dialog embeds it ──
  const videosBtn = row.locator('button', { hasText: 'Videos (1)' })
  await expect(videosBtn).toBeVisible({ timeout: 10_000 })
  await videosBtn.click()
  const player = page.getByTestId('sop-videos-dialog').locator('video')
  await expect(player).toBeVisible()
  const src = await player.getAttribute('src')
  expect(src).toMatch(/\/api\/sop-videos\/\d+/)

  // ── Playback streams over HTTP with the session cookie ──
  const res = await page.request.get(src!, { headers: { range: 'bytes=0-99' } })
  expect([200, 206]).toContain(res.status())
  expect(res.headers()['content-type']).toContain('video/')
  const body = await res.body()
  expect(body.length).toBeGreaterThan(0)
  // webm container magic (EBML) proves real encoded bytes came back.
  expect(body.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
})
