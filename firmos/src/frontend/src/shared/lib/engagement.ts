import type { Quote } from '@firmos/domain'
import type { WizardAnswers } from '@/components/intake/registry'

export interface AcceptedEstimateSnapshot {
  version: 1
  acceptedAt: string
  answers: WizardAnswers
  quote: Quote
}

export interface AgreementTemplate {
  body: string
  firmName: string
}

export function renderEngagementAgreement(
  snapshot: AcceptedEstimateSnapshot,
  template: AgreementTemplate,
): string {
  const clientName = snapshot.answers.dbaName ?? snapshot.answers.legalName ?? 'Client'
  const effectiveMonthly = snapshot.quote.totals.effectiveMonthly.toFixed(2)
  const oneTime = snapshot.quote.totals.totalOneTime.toFixed(2)
  const replacements: Record<string, string> = {
    '{{clientName}}': clientName,
    '{{firmName}}': template.firmName,
    '{{acceptedAt}}': snapshot.acceptedAt,
    '{{monthlyRecurring}}': effectiveMonthly,
    '{{oneTimeTotal}}': oneTime,
    '{{estimateSummary}}': `Effective monthly recurring: $${effectiveMonthly}\nOne-time fees and cleanup: $${oneTime}`,
  }
  return Object.entries(replacements).reduce(
    (body, [token, value]) => body.replaceAll(token, value),
    template.body,
  )
}
