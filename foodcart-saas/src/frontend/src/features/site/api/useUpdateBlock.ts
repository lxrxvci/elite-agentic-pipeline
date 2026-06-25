import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { ContentBlock, ContentBlockCreate } from '@/shared/api/foodcart-types'

export function useUpdateBlock(siteId: string | undefined, blockId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation<ContentBlock, Error, ContentBlockCreate>({
    mutationFn: (body) => apiClient(`/sites/${siteId}/content/blocks/${blockId}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites', siteId, 'content'] })
    },
  })
}
