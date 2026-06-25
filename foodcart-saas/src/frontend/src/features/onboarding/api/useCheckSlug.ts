import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { SlugCheckRequest, SlugCheckResponse } from '@/shared/api/foodcart-types'

export function useCheckSlug() {
  return useMutation<SlugCheckResponse, Error, SlugCheckRequest>({
    mutationFn: (body) => apiClient('/tenants/slug/check', { method: 'POST', body: JSON.stringify(body) }),
  })
}
