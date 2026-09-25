import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { CHAPTERS } from '@/components/intake/registry'
import { ExtractionReview, type ExtractionReviewRow } from '@/components/intake/extraction-review'
import { requireStaff } from '@/server/auth/guards'
import { getIntakeTranscript } from '@/server/intake-import'
import {
  describeExtractedValue,
  extractionFieldSpec,
  missingLabel,
  type ExtractionResult,
} from '@/server/intake-extract'

export const metadata: Metadata = { title: 'FirmOS - Review extracted intake' }

export const dynamic = 'force-dynamic'

const CHAPTER_LABELS = new Map(CHAPTERS.map((c) => [c.id, c.label]))

/**
 * The extraction review screen (ADR-0006): the human gate between a call
 * transcript and an intake draft. The server serializes plain review rows
 * (labels, display values, edit affordances) so the client component never
 * touches the extraction vocabulary module.
 */
export default async function ExtractionReviewPage({
  params,
}: {
  params: Promise<{ transcriptId: string }>
}) {
  const { transcriptId: raw } = await params
  const transcriptId = Number(raw)
  if (!Number.isInteger(transcriptId) || transcriptId <= 0) notFound()

  await requireStaff()
  const row = await getIntakeTranscript(transcriptId)
  if (!row) notFound()

  const extraction = (row.extraction ?? null) as ExtractionResult | null

  const rows: ExtractionReviewRow[] = (extraction?.fields ?? []).map((f) => {
    const spec = extractionFieldSpec(f.key)
    return {
      key: f.key,
      label: spec?.label ?? f.key,
      chapter: f.group ?? spec?.chapter ?? 'entity',
      chapterLabel: CHAPTER_LABELS.get(f.group ?? spec?.chapter ?? '') ?? 'Other',
      kind: spec?.kind ?? 'string',
      // Edit options only apply to single-value enums (list kinds are not
      // inline-editable in v1).
      options:
        spec?.kind === 'enum'
          ? spec.options?.map((value) => ({ value, label: describeExtractedValue(f.key, value) }))
          : undefined,
      value: f.value,
      displayValue: describeExtractedValue(f.key, f.value),
      confidence: f.confidence,
      evidence: f.evidence,
    }
  })

  const chapters = CHAPTERS.flatMap((c) => {
    const chapterRows = rows.filter((r) => r.chapter === c.id)
    return chapterRows.length > 0 ? [{ id: c.id, label: c.label, rows: chapterRows }] : []
  })
  const known = new Set(CHAPTERS.map((c) => c.id))
  const otherRows = rows.filter((r) => !known.has(r.chapter))
  if (otherRows.length > 0) chapters.push({ id: 'other', label: 'Other', rows: otherRows })

  return (
    <ExtractionReview
      transcriptId={row.id}
      intakeId={row.intakeId}
      fileName={row.fileName}
      model={row.model}
      status={row.status}
      suggestedLegalName={extraction?.suggestedLegalName ?? null}
      chapters={chapters}
      fieldCount={rows.length}
      missing={(extraction?.missing ?? []).map((key) => ({ key, label: missingLabel(key) }))}
      rejected={(extraction?.rejected ?? []).map((r) => ({ key: r.key, reason: r.reason }))}
      errorMessage={extraction?.error ?? null}
    />
  )
}
