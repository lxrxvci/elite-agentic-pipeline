import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingWizard } from './OnboardingWizard'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('../api/useCheckSlug', () => ({
  useCheckSlug: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ slug: 'tacos', available: true }),
    isPending: false,
  }),
}))

const mutateAsyncMock = vi.fn().mockResolvedValue({})
vi.mock('../api/useOnboard', () => ({
  useOnboard: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
    error: null,
  }),
}))

vi.mock('@/shared/lib/features', () => ({
  isFeatureEnabled: vi.fn(),
}))

vi.mock('../api/usePresignedUpload', () => ({
  usePresignedUpload: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      upload_url: 'https://r2.example.com',
      fields: {},
      storage_key: 'key',
      public_url: 'https://cdn.example.com/photo.jpg',
      image_id: 'uploaded-image-id',
      expires_in: 300,
    }),
    isPending: false,
  }),
}))

vi.mock('../lib/compressImage', () => ({
  compressImage: vi.fn().mockResolvedValue({
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    contentType: 'image/jpeg',
    width: 800,
    height: 600,
  }),
}))

vi.mock('../lib/uploadImage', () => ({
  uploadImageToStorage: vi.fn().mockResolvedValue({
    imageId: 'uploaded-image-id',
    publicUrl: 'https://cdn.example.com/photo.jpg',
  }),
}))

vi.mock('@/shared/lib/telemetry', () => ({
  trackUploadStep: vi.fn(),
  trackOnboardingStep: vi.fn(),
  trackError: vi.fn(),
  send: vi.fn(),
  telemetry: { send: vi.fn() },
}))

import { isFeatureEnabled } from '@/shared/lib/features'

async function fillIdentityStep() {
  await userEvent.type(screen.getByLabelText(/Business name/i), 'Taco Cart')
  await userEvent.type(screen.getByLabelText(/Site address/i), 'taco-cart')
}

describe('OnboardingWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushMock.mockClear()
    mutateAsyncMock.mockClear()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  it('advances through identity, links, brand, and preview steps when photo flag is off', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(false)
    render(<OnboardingWizard />)
    expect(screen.getByText(/Business name/i)).toBeInTheDocument()

    await fillIdentityStep()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/Google Business Profile/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByLabelText(/Primary brand color/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/Ready to publish/i)).toBeInTheDocument()
  })

  it('shows a Photo step when photo flag is on', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true)
    render(<OnboardingWizard />)

    await fillIdentityStep()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))

    expect(screen.getByText(/Snap or upload a photo/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upload or drop a photo/i })).toBeInTheDocument()
  })

  it('includes photo_image_id in onboard payload when a photo is uploaded', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true)
    render(<OnboardingWizard />)

    await fillIdentityStep()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))

    const file = new File(['x'], 'cart.jpg', { type: 'image/jpeg' })
    const input = screen.getByTestId('photo-file-input') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file] })
    fireEvent.change(input)

    // Wait for upload success state.
    expect(await screen.findByText(/Photo uploaded successfully/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /Publish now/i }))

    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ photo_image_id: 'uploaded-image-id' })
    )
  })

  it('omits photo_image_id when photo step is skipped', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true)
    render(<OnboardingWizard />)

    await fillIdentityStep()
    await userEvent.click(screen.getByRole('button', { name: /next/i }))

    await userEvent.click(screen.getByRole('button', { name: /Skip this step/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /Publish now/i }))

    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ photo_image_id: undefined })
    )
  })
})
