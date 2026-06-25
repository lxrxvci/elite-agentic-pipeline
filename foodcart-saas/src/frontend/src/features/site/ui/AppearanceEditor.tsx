'use client'

import { Card, TemplateSelector, type TemplateOption, Button } from '@/shared/ui'
import { useSites } from '../api/useSites'
import { useUpdateSite } from '../api/useUpdateSite'
import { TEMPLATES } from '@/features/public-site/lib/templates'
import type { TemplateId } from '@/shared/api/foodcart-types'

export function AppearanceEditor() {
  const { data: sites } = useSites()
  const site = sites?.[0]
  const updateSite = useUpdateSite(site?.id)

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Appearance</h1>
      <Card>
        <h2 className="font-semibold text-lg mb-4">Template</h2>
        <TemplateSelector
          templates={TEMPLATES as TemplateOption[]}
          selectedId={site?.template_id}
          onSelect={(id) => updateSite.mutate({ template_id: id as TemplateId })}
        />
      </Card>
      <Button onClick={() => window.open(`/sites/${site?.slug}`, '_blank')} disabled={!site}>
        Preview live site
      </Button>
    </div>
  )
}
