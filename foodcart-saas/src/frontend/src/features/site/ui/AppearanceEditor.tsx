'use client'

import { useState, useEffect } from 'react'
import { Card, TemplateSelector, type TemplateOption, Button, Field, Input } from '@/shared/ui'
import { useSites } from '../api/useSites'
import { useUpdateSite } from '../api/useUpdateSite'
import { TEMPLATES } from '@/features/public-site/lib/templates'
import type { TemplateId, BrandColors } from '@/shared/api/foodcart-types'

const DEFAULT_BRAND_COLORS: BrandColors = {
  primary: '#2563eb',
  secondary: '#f5f5f5',
  background: '#ffffff',
}

export function AppearanceEditor() {
  const { data: sites } = useSites()
  const site = sites?.[0]
  const updateSite = useUpdateSite(site?.id)
  const [brandColors, setBrandColors] = useState<BrandColors>(DEFAULT_BRAND_COLORS)

  useEffect(() => {
    if (site?.brand_colors) setBrandColors(site.brand_colors)
  }, [site?.brand_colors])

  if (!site) {
    return <div className="space-y-6"><h1 className="font-display text-3xl font-bold">Appearance</h1><p className="text-fc-text-secondary">No site found.</p></div>
  }

  const isCustom = site.template_id === 'custom'

  const saveColors = () => {
    updateSite.mutate({ brand_colors: brandColors })
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Appearance</h1>
      <Card>
        {isCustom ? (
          <div className="space-y-4">
            <h2 className="font-semibold text-lg mb-2">Brand colors</h2>
            <div className="grid md:grid-cols-3 gap-4">
              {[
                { key: 'primary', label: 'Primary' },
                { key: 'secondary', label: 'Secondary' },
                { key: 'background', label: 'Background' },
              ].map(({ key, label }) => {
                const colorKey = key as keyof BrandColors
                return (
                  <Field key={key} id={`appearance-color-${key}`} label={label}>
                    <div className="flex items-center gap-3">
                      <input
                        id={`appearance-color-${key}`}
                        type="color"
                        value={brandColors[colorKey]}
                        onChange={(e) => setBrandColors((c) => ({ ...c, [colorKey]: e.target.value }))}
                        className="h-12 w-12 rounded-lg border border-fc-neutral-300 p-1 cursor-pointer"
                        aria-label={`${label} brand color`}
                      />
                      <Input
                        value={brandColors[colorKey]}
                        onChange={(e) => setBrandColors((c) => ({ ...c, [colorKey]: e.target.value }))}
                        pattern="^#[0-9a-fA-F]{6}$"
                        className="flex-1"
                      />
                    </div>
                  </Field>
                )
              })}
            </div>
            <Button onClick={saveColors} loading={updateSite.isPending}>Save colors</Button>
          </div>
        ) : (
          <>
            <h2 className="font-semibold text-lg mb-4">Template</h2>
            <TemplateSelector
              templates={TEMPLATES as TemplateOption[]}
              selectedId={site.template_id}
              onSelect={(id) => updateSite.mutate({ template_id: id as TemplateId })}
            />
          </>
        )}
      </Card>
      <Button onClick={() => window.open(`/sites/${site.slug}`, '_blank')}>
        Preview live site
      </Button>
    </div>
  )
}
