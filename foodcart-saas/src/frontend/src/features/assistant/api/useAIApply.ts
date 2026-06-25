import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { AIApplyRequest, Revision } from '@/shared/api/foodcart-types'

export function useAIApply(siteId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation<Revision, Error, AIApplyRequest>({
    mutationFn: (body) => apiClient(`/sites/${siteId}/ai/apply`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites', siteId, 'content'] })
      queryClient.invalidateQueries({ queryKey: ['sites', siteId, 'revisions'] })
    },
  })
}
