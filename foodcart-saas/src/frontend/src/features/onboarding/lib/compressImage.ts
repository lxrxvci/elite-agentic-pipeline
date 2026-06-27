export interface CompressionResult {
  blob: Blob
  contentType: string
  width: number
  height: number
}

export interface CompressionOptions {
  maxWidth?: number
  maxHeight?: number
  maxBytes?: number
  quality?: number
  outputType?: 'image/jpeg' | 'image/webp'
}

const DEFAULT_MAX_WIDTH = 1920
const DEFAULT_MAX_HEIGHT = 1920
const DEFAULT_MAX_BYTES = 1.8 * 1024 * 1024
const DEFAULT_QUALITY = 0.85

function getImageDimensions(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  let { width, height } = { width: naturalWidth, height: naturalHeight }

  if (width > maxWidth) {
    height = Math.round((height * maxWidth) / width)
    width = maxWidth
  }
  if (height > maxHeight) {
    width = Math.round((width * maxHeight) / height)
    height = maxHeight
  }

  return { width, height }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, contentType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Canvas toBlob returned null'))
        }
      },
      contentType,
      quality
    )
  })
}

export async function compressImage(
  file: File,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const {
    maxWidth = DEFAULT_MAX_WIDTH,
    maxHeight = DEFAULT_MAX_HEIGHT,
    maxBytes = DEFAULT_MAX_BYTES,
    quality = DEFAULT_QUALITY,
    outputType = 'image/jpeg',
  } = options

  const dataUrl = await blobToDataUrl(file)
  const img = await loadImage(dataUrl)
  const { width, height } = getImageDimensions(img.naturalWidth, img.naturalHeight, maxWidth, maxHeight)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Could not get 2d canvas context')
  }

  ctx.drawImage(img, 0, 0, width, height)

  let blob = await canvasToBlob(canvas, outputType, quality)

  // Reduce quality if the result is still too large.
  let currentQuality = quality
  while (blob.size > maxBytes && currentQuality > 0.3) {
    currentQuality -= 0.1
    blob = await canvasToBlob(canvas, outputType, currentQuality)
  }

  return {
    blob,
    contentType: outputType,
    width,
    height,
  }
}
