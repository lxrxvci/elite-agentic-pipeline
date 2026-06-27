import { trackError } from '@/shared/lib/telemetry'
import type { PresignedUploadResponse } from '@/shared/api/foodcart-types'

export class ImageUploadError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
    this.name = 'ImageUploadError'
  }
}

export async function uploadImageToStorage(
  file: Blob,
  presigned: PresignedUploadResponse
): Promise<{ imageId: string; publicUrl: string }> {
  const formData = new FormData()

  Object.entries(presigned.fields).forEach(([key, value]) => {
    formData.append(key, value)
  })

  formData.append('file', file)

  const response = await fetch(presigned.upload_url, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = new ImageUploadError(`Direct upload failed: ${response.statusText}`, response.status)
    trackError(error)
    throw error
  }

  return {
    imageId: presigned.image_id,
    publicUrl: presigned.public_url,
  }
}
