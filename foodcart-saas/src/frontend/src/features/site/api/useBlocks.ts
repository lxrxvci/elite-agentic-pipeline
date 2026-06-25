import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { ContentBlock } from '@/shared/api/foodcart-types'

interface BlocksResponse {
  site_id: string
  blocks: ContentBlock[]
}

export function useBlocks(siteId: string | undefined) {
  return useQuery<BlocksResponse>({
    queryKey: ['sites', siteId, 'content'],
    queryFn: () => apiClient(`/sites/${siteId}/content`),
    enabled: !!siteId,
    staleTime: 60 * 1000,
  })
}
