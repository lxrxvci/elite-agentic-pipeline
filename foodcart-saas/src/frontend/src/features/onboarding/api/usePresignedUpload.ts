'use client'

import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { PresignedUploadRequest, PresignedUploadResponse } from '@/shared/api/foodcart-types'

export function usePresignedUpload() {
  return useMutation<PresignedUploadResponse, Error, PresignedUploadRequest>({
    mutationFn: (body) => apiClient('/uploads/presigned', { method: 'POST', body: JSON.stringify(body) }),
  })
}
