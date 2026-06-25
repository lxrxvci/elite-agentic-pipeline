'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field, Input, TemplateSelector, type TemplateOption } from '@/shared/ui'
import { useCheckSlug } from '../api/useCheckSlug'
import { useOnboard } from '../api/useOnboard'
import type { TemplateId, IngestionRequest } from '@/shared/api/foodcart-types'
import { OnboardingStepper } from './OnboardingStepper'
import { TEMPLATES } from '@/features/public-site/lib/templates'

const STEPS = ['Identity', 'Links', 'Template', 'Preview']

export function OnboardingWizard() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [businessName, setBusinessName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
  const [templateId, setTemplateId] = useState<TemplateId | undefined>()
  const [links, setLinks] = useState<IngestionRequest>({})
  const checkSlug = useCheckSlug()
  const onboard = useOnboard()

  const validateSlug = async (value: string) => {
    const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63)
    setSlug(normalized)
    if (normalized.length < 2) {
      setSlugAvailable(null)
      return
    }
    try {
      const result = await checkSlug.mutateAsync({ slug: normalized })
      setSlugAvailable(result.available)
    } catch {
      setSlugAvailable(false)
    }
  }

  const handleNext = () => {
    if (step === STEPS.length - 1) {
      handlePublish()
      return
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const handleBack = () => setStep((s) => Math.max(s - 1, 0))

  const handlePublish = async () => {
    if (!businessName || !slug || !templateId) return
    try {
      await onboard.mutateAsync({
        business_name: businessName,
        slug,
        template_id: templateId,
        initial_sources: links,
      })
      router.push('/admin/dashboard')
    } catch {
      // error shown via onboard.error
    }
  }

  const canProceed = (() => {
    if (step === 0) return businessName.length > 0 && slug.length > 2 && slugAvailable === true
    if (step === 2) return !!templateId
    return true
  })()

  return (
    <div data-testid="onboarding-wizard" className="min-h-screen bg-fc-neutral-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Card className="p-6 md:p-10">
          <div className="mb-8">
            <OnboardingStepper steps={STEPS} current={step} />
          </div>
          {step === 0 && (
            <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); handleNext() }}>
              <Field id="business-name" label="Business name" required>
                <Input
                  id="business-name"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Diego’s Barbacoa"
                  required
                />
              </Field>
              <Field id="slug" label="Site address" hint="letters, numbers, and dashes only" required>
                <div className="flex items-center gap-2">
                  <Input
                    id="slug"
                    value={slug}
                    onChange={(e) => validateSlug(e.target.value)}
                    placeholder="your-business"
                    required
                    aria-describedby="slug-suffix"
                  />
                  <span id="slug-suffix" className="text-fc-text-secondary whitespace-nowrap">.foodcartsite.com</span>
                </div>
                {slugAvailable === true && <p className="text-sm text-fc-success-text mt-1">{slug} is available</p>}
                {slugAvailable === false && <p className="text-sm text-fc-danger-text mt-1">{slug} is unavailable</p>}
              </Field>
            </form>
          )}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-fc-text-secondary">Add links to your existing presence. Everything is optional.</p>
              {[
                { key: 'website_url', label: 'Website' },
                { key: 'menu_url', label: 'Menu URL' },
                { key: 'google_business_url', label: 'Google Business Profile' },
                { key: 'yelp_url', label: 'Yelp' },
              ].map(({ key, label }) => (
                <Field key={key} id={key} label={label}>
                  <Input
                    id={key}
                    value={(links[key as keyof IngestionRequest] as string) || ''}
                    onChange={(e) => setLinks((l) => ({ ...l, [key]: e.target.value }))}
                    placeholder={`https://...`}
                    type="url"
                  />
                </Field>
              ))}
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-fc-text-secondary">Choose a look that matches your brand.</p>
              <TemplateSelector
                templates={TEMPLATES as TemplateOption[]}
                selectedId={templateId}
                onSelect={setTemplateId}
              />
            </div>
          )}
          {step === 3 && (
            <div className="space-y-6">
              <div className="bg-fc-success/10 text-fc-success-text rounded-xl p-4">
                <h3 className="font-semibold">Ready to publish</h3>
                <p className="text-sm mt-1">{businessName} will be live at <strong>{slug}.foodcartsite.com</strong></p>
                <p className="text-sm">Template: <strong>{TEMPLATES.find((t) => t.id === templateId)?.name}</strong></p>
              </div>
              {onboard.error && <p className="text-sm text-fc-danger-text" role="alert">{onboard.error.message}</p>}
            </div>
          )}
          <div className="flex items-center justify-between mt-10">
            <Button variant="ghost" onClick={handleBack} disabled={step === 0}>Back</Button>
            <Button onClick={handleNext} loading={onboard.isPending || checkSlug.isPending} disabled={!canProceed}>
              {step === STEPS.length - 1 ? 'Publish now' : 'Next'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
