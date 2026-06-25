'use client'

import Link from 'next/link'
import { Card, Button } from '@/shared/ui'
import { useSites } from '../api/useSites'
import { useUpdateSite } from '../api/useUpdateSite'

export function DashboardOverview() {
  const { data: sites } = useSites()
  const site = sites?.[0]
  const updateSite = useUpdateSite(site?.id)

  const togglePublish = () => {
    if (!site) return
    updateSite.mutate({ publish_state: site.publish_state === 'published' ? 'draft' : 'published' })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Site overview</h1>
        {site && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-fc-text-secondary">
              {site.publish_state === 'published' ? 'Published' : 'Draft'}
            </span>
            <Button onClick={togglePublish} loading={updateSite.isPending} variant={site.publish_state === 'published' ? 'secondary' : 'primary'}>
              {site.publish_state === 'published' ? 'Unpublish' : 'Publish'}
            </Button>
          </div>
        )}
      </div>
      {site && (
        <Card>
          <h2 className="font-semibold text-lg mb-2">{site.slug}.webagentic.app</h2>
          <p className="text-fc-text-secondary mb-4">Template: {site.template_id}</p>
          <div className="flex gap-3">
            <Link href={`/sites/${site.slug}`} target="_blank" className="inline-flex items-center rounded-lg bg-fc-cobalt-600 text-white px-4 py-2 text-sm font-semibold hover:bg-fc-cobalt-700">
              View live site
            </Link>
            <Link href="/admin/dashboard/appearance" className="inline-flex items-center rounded-lg border border-fc-neutral-300 px-4 py-2 text-sm font-semibold hover:bg-fc-neutral-50">
              Change template
            </Link>
          </div>
        </Card>
      )}
      <div className="grid md:grid-cols-3 gap-6">
        <Card>
          <h3 className="font-semibold mb-1">Business info</h3>
          <p className="text-sm text-fc-text-secondary mb-3">Name, story, contact details.</p>
          <Link href="/admin/dashboard/business" className="text-fc-cobalt-600 text-sm font-semibold hover:underline">Edit →</Link>
        </Card>
        <Card>
          <h3 className="font-semibold mb-1">Hours</h3>
          <p className="text-sm text-fc-text-secondary mb-3">Weekly schedule and special hours.</p>
          <Link href="/admin/dashboard/hours" className="text-fc-cobalt-600 text-sm font-semibold hover:underline">Edit →</Link>
        </Card>
        <Card>
          <h3 className="font-semibold mb-1">Links</h3>
          <p className="text-sm text-fc-text-secondary mb-3">Social and order platforms.</p>
          <Link href="/admin/dashboard/links" className="text-fc-cobalt-600 text-sm font-semibold hover:underline">Edit →</Link>
        </Card>
      </div>
    </div>
  )
}
