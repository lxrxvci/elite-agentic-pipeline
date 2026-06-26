import { useMutation, useQuery } from '@tanstack/react-query'

import { apiClient } from '@/shared/api/client'
import type {
  DomainPurchaseRequest,
  DomainPurchaseResponse,
  DomainSearchResponse,
} from '@/shared/api/foodcart-types'

export function useDomainSearch(query: string) {
  return useQuery<DomainSearchResponse>({
    queryKey: ['domains', 'search', query],
    queryFn: () => apiClient(`/domains/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 1,
    staleTime: 30 * 1000,
  })
}

export function useDomainCheck() {
  return useMutation({
    mutationFn: (domains: string[]) =>
      apiClient<DomainSearchResponse>('/domains/check', {
        method: 'POST',
        body: JSON.stringify(domains),
      }),
  })
}

export function useDomainPurchase(siteId: string | undefined) {
  return useMutation({
    mutationFn: (body: DomainPurchaseRequest) =>
      apiClient<DomainPurchaseResponse>(`/domains/sites/${siteId}/purchase`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}
