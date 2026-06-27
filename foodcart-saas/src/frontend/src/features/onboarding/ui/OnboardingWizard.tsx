'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field, Input } from '@/shared/ui'
import { useCheckSlug } from '../api/useCheckSlug'
import { useOnboard } from '../api/useOnboard'
import type { IngestionRequest, BrandColors } from '@/shared/api/foodcart-types'
import { isFeatureEnabled } from '@/shared/lib/features'
import { OnboardingStepper } from './OnboardingStepper'
import { PhotoUploadStep } from './PhotoUploadStep'

const DEFAULT_STEPS = ['Identity', 'Links', 'Brand', 'Preview']
const PHOTO_STEPS = ['Identity', 'Photo', 'Links', 'Brand', 'Preview']

const DEFAULT_BRAND_COLORS: BrandColors = {
  primary: '#2563eb',
  secondary: '#f5f5f5',
  background: '#ffffff',
}

const DELIVERY_PLATFORMS = [
  { key: 'doordash', label: 'DoorDash' },
  { key: 'ubereats', label: 'UberEats' },
  { key: 'grubhub', label: 'Grubhub' },
] as const

interface DeliveryLinks {
  doordash: string
  ubereats: string
  grubhub: string
}

export function OnboardingWizard() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [businessName, setBusinessName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
  const [brandColors, setBrandColors] = useState<BrandColors>(DEFAULT_BRAND_COLORS)
  const [links, setLinks] = useState<IngestionRequest>({})
  const [delivery, setDelivery] = useState<DeliveryLinks>({ doordash: '', ubereats: '', grubhub: '' })
  const [photoImageId, setPhotoImageId] = useState<string | null>(null)
  const checkSlug = useCheckSlug()
  const onboard = useOnboard()

  const photoEnabled = isFeatureEnabled('photo-onboarding-v1')
  const steps = photoEnabled ? PHOTO_STEPS : DEFAULT_STEPS

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
    if (step === steps.length - 1) {
      handlePublish()
      return
    }
    setStep((s) => Math.min(s + 1, steps.length - 1))
  }

  const handleBack = () => setStep((s) => Math.max(s - 1, 0))

  const handlePublish = async () => {
    if (!businessName || !slug) return
    const orderLinks = DELIVERY_PLATFORMS
      .map(({ key }) => ({ platform: key, url: delivery[key] }))
      .filter((link) => link.url)
    try {
      await onboard.mutateAsync({
        business_name: businessName,
        slug,
        template_id: 'custom',
        brand_colors: brandColors,
        initial_sources: {
          ...links,
          order_links: orderLinks.length > 0 ? orderLinks : undefined,
        },
        photo_image_id: photoImageId ?? undefined,
      })
      router.push('/admin/dashboard')
    } catch {
      // error shown via onboard.error
    }
  }

  const brandStepIndex = photoEnabled ? 3 : 2
  const canProceed = (() => {
    if (step === 0) return businessName.length > 0 && slug.length > 2 && slugAvailable === true
    if (step === brandStepIndex) return !!brandColors.primary && !!brandColors.secondary && !!brandColors.background
    return true
  })()

  return (
    <div data-testid="onboarding-wizard" className="min-h-screen bg-fc-neutral-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Card className="p-6 md:p-10">
          <div className="mb-8">
            <OnboardingStepper steps={steps} current={step} />
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
                  <span id="slug-suffix" className="text-fc-text-secondary whitespace-nowrap">.webagentic.app</span>
                </div>
                {slugAvailable === true && <p className="text-sm text-fc-success-text mt-1">{slug} is available</p>}
                {slugAvailable === false && <p className="text-sm text-fc-danger-text mt-1">{slug} is unavailable</p>}
              </Field>
            </form>
          )}
          {photoEnabled && step === 1 && (
            <PhotoUploadStep
              onPhotoUploaded={(imageId) => {
                setPhotoImageId(imageId)
              }}
              onSkip={() => {
                setPhotoImageId(null)
              }}
            />
          )}

          {((photoEnabled && step === 2) || (!photoEnabled && step === 1)) && (
            <div className="space-y-6">
              <p className="text-fc-text-secondary">Add links to your existing presence. Everything is optional.</p>
              <div className="space-y-4">
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
              <div>
                <h3 className="font-semibold mb-3">Delivery platforms</h3>
                <div className="grid md:grid-cols-3 gap-4">
                  {DELIVERY_PLATFORMS.map(({ key, label }) => (
                    <Field key={key} id={`delivery-${key}`} label={label}>
                      <Input
                        id={`delivery-${key}`}
                        value={delivery[key]}
                        onChange={(e) => setDelivery((d) => ({ ...d, [key]: e.target.value }))}
                        placeholder="https://..."
                        type="url"
                      />
                    </Field>
                  ))}
                </div>
              </div>
            </div>
          )}
          {((photoEnabled && step === 3) || (!photoEnabled && step === 2)) && (
            <div className="space-y-6">
              <p className="text-fc-text-secondary">Choose your brand colors. We&apos;ll use them across your public site.</p>
              <div className="grid md:grid-cols-3 gap-6">
                {[
                  { key: 'primary', label: 'Primary', hint: 'Buttons and highlights' },
                  { key: 'secondary', label: 'Secondary', hint: 'Accent sections' },
                  { key: 'background', label: 'Background', hint: 'Page background' },
                ].map(({ key, label, hint }) => {
                  const colorKey = key as keyof BrandColors
                  return (
                    <Field key={key} id={`color-${key}`} label={label} hint={hint}>
                      <div className="flex items-center gap-3">
                        <input
                          id={`color-${key}`}
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
            </div>
          )}
          {((photoEnabled && step === 4) || (!photoEnabled && step === 3)) && (
            <div className="space-y-6">
              <div className="bg-fc-success/10 text-fc-success-text rounded-xl p-4">
                <h3 className="font-semibold">Ready to publish</h3>
                <p className="text-sm mt-1">{businessName} will be live at <strong>{slug}.webagentic.app</strong></p>
                <div className="flex items-center gap-3 mt-3">
                  {(['primary', 'secondary', 'background'] as const).map((key) => (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      <span
                        className="inline-block h-5 w-5 rounded-full border border-fc-neutral-300"
                        style={{ backgroundColor: brandColors[key] }}
                        aria-hidden="true"
                      />
                      <span className="capitalize">{key}</span>
                    </div>
                  ))}
                </div>
              </div>
              {onboard.error && <p className="text-sm text-fc-danger-text" role="alert">{onboard.error.message}</p>}
            </div>
          )}
          <div className="flex items-center justify-between mt-10">
            <Button variant="ghost" onClick={handleBack} disabled={step === 0}>Back</Button>
            <Button onClick={handleNext} loading={onboard.isPending || checkSlug.isPending} disabled={!canProceed}>
              {step === steps.length - 1 ? 'Publish now' : 'Next'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
