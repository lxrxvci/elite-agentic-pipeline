import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compressImage } from './compressImage'

function createMockBlob(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' })
}

function setupCanvasMock(blobSize: number) {
  const toBlob = vi.fn((callback: (blob: Blob | null) => void) => {
    callback(createMockBlob(blobSize))
  })

  const drawImage = vi.fn()

  const createElement = vi.spyOn(document, 'createElement').mockReturnValue({
    getContext: () => ({ drawImage }),
    toBlob,
    width: 0,
    height: 0,
  } as unknown as HTMLCanvasElement)

  return { toBlob, drawImage, createElement }
}

function setupImageMock(naturalWidth: number, naturalHeight: number) {
  let onload: (() => void) | null = null
  const imageSpy = vi.spyOn(window, 'Image').mockImplementation(() => {
    const img = {
      naturalWidth,
      naturalHeight,
      set src(_value: string) {
        setTimeout(() => onload?.(), 0)
      },
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
    } as unknown as HTMLImageElement
    onload = () => img.onload?.call(img, {} as Event)
    return img
  })
  return imageSpy
}

describe('compressImage', () => {
  beforeEach(() => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      setTimeout(() => {
        this.onload?.({ target: { result: 'data:image/jpeg;base64,abc' } } as unknown as ProgressEvent<FileReader>)
      }, 0)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resizes images larger than max dimensions', async () => {
    setupImageMock(4000, 3000)
    const { drawImage, toBlob } = setupCanvasMock(100_000)

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(file, { maxWidth: 1920, maxHeight: 1920 })

    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      1920,
      1440
    )
    expect(result.contentType).toBe('image/jpeg')
    expect(result.width).toBe(1920)
    expect(result.height).toBe(1440)
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85)
  })

  it('keeps small images at original size', async () => {
    setupImageMock(800, 600)
    const { drawImage } = setupCanvasMock(50_000)

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(file)

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600)
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
  })

  it('reduces quality when blob exceeds max bytes', async () => {
    setupImageMock(800, 600)
    let callCount = 0
    const { toBlob } = setupCanvasMock(0)
    toBlob.mockImplementation((callback: (blob: Blob | null) => void) => {
      callCount += 1
      // First call is too large, second fits.
      callback(createMockBlob(callCount === 1 ? 2_000_000 : 500_000))
    })

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(file, { maxBytes: 1_000_000 })

    expect(toBlob).toHaveBeenCalledTimes(2)
  })
})
