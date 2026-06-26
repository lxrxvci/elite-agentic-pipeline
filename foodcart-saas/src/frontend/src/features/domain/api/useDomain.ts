import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/shared/api/client'
import type {
  ConnectDomainRequest,
  DomainStatus,
  Site,
} from '@/shared/api/foodcart-types'

const domainStatusKey = (siteId: string | undefined) =>
  ['sites', siteId, 'domain'] as const

export function useDomainStatus(siteId: string | undefined) {
  return useQuery<DomainStatus>({
    queryKey: domainStatusKey(siteId),
    queryFn: () => apiClient(`/sites/${siteId}/domain/status`),
    enabled: !!siteId,
    staleTime: 30 * 1000,
  })
}

export function useConnectDomain(siteId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ConnectDomainRequest) =>
      apiClient<Site>(`/sites/${siteId}/domain`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      queryClient.invalidateQueries({ queryKey: domainStatusKey(siteId) })
    },
  })
}

export function useDisconnectDomain(siteId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient(`/sites/${siteId}/domain`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      queryClient.invalidateQueries({ queryKey: domainStatusKey(siteId) })
    },
  })
}
