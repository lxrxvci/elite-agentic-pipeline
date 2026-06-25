import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { AIProposeRequest, AIProposeResponse } from '@/shared/api/foodcart-types'

export function useAIPropose(siteId: string | undefined) {
  return useMutation<AIProposeResponse, Error, AIProposeRequest>({
    mutationFn: (body) => apiClient(`/sites/${siteId}/ai/propose`, { method: 'POST', body: JSON.stringify(body) }),
  })
}
