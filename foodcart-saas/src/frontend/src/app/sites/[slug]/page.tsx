'use client'

import { useParams } from 'next/navigation'
import { usePublicSite } from '@/features/public-site/api/usePublicSite'
import { PublicSitePage } from '@/features/public-site/ui/PublicSitePage'

export default function SitePage() {
  const params = useParams()
  const slug = typeof params.slug === 'string' ? params.slug : undefined
  const { data: site, isLoading, error } = usePublicSite(slug)

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-fc-neutral-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-fc-cobalt-600 border-t-transparent" aria-label="Loading site" />
      </div>
    )
  }

  if (error || !site) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-fc-neutral-50 p-6">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">Site not found</h1>
          <p className="text-fc-text-secondary">We couldn&apos;t find a published site at this address.</p>
        </div>
      </div>
    )
  }

  return <PublicSitePage site={site} />
}
