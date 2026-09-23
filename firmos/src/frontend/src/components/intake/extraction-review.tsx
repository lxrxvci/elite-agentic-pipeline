'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronRight, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { checkDuplicates } from '@/server/actions/intake'
import { confirmExtraction, retryExtraction } from '@/server/actions/intake-import'
import type { DuplicateCandidate } from '@/server/intake'
import { cn } from '@/shared/lib/utils'

/**
 * The extraction review screen (ADR-0006): every extracted field with its
 * confidence and verbatim evidence, grouped by wizard chapter. Accept, edit,
 * or discard each row; only accepted fields are written, and only when the
 * human hits confirm. Confidence uses the status-color language: green
 * (>=0.9) auto-checked, amber (0.6-0.9) checked, red (<0.6) unchecked.
 */

export interface ExtractionReviewRow {
  key: string
  label: string
  chapter: string
  chapterLabel: string
  kind: string
  options?: Array<{ value: string; label: string }>
  value: unknown
  displayValue: string
  confidence: number
  evidence: string
}

export interface ExtractionReviewChapter {
  id: string
  label: string
  rows: ExtractionReviewRow[]
}

type ConfidenceTier = 'high' | 'medium' | 'low'

function tierOf(confidence: number): ConfidenceTier {
  if (confidence >= 0.9) return 'high'
  if (confidence >= 0.6) return 'medium'
  return 'low'
}

const TIER_CLASSES: Record<ConfidenceTier, string> = {
  high: 'border-status-on-track/40 bg-status-on-track-bg text-status-on-track',
  medium: 'border-status-due-soon/40 bg-status-due-soon-bg text-status-due-soon',
  low: 'border-status-overdue/40 bg-status-overdue-bg text-status-overdue',
}

function ConfidenceBadge({ confidence, keyName }: { confidence: number; keyName: string }) {
  const tier = tierOf(confidence)
  return (
    <span
      className={cn(
        'tnum inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        TIER_CLASSES[tier],
      )}
      data-testid={`confidence-${keyName}`}
      data-tier={tier}
    >
      {Math.round(confidence * 100)}%
    </span>
  )
}

interface RowState {
  accepted: boolean
  value: unknown
  editing: boolean
  showEvidence: boolean
}

export function ExtractionReview({
  transcriptId,
  intakeId,
  fileName,
  model,
  status,
  suggestedLegalName,
  chapters,
  fieldCount,
  missing,
  rejected,
  errorMessage,
}: {
  transcriptId: number
  intakeId: number | null
  fileName: string
  model: string | null
  status: 'uploaded' | 'extracted' | 'confirmed' | 'failed'
  suggestedLegalName: string | null
  chapters: ExtractionReviewChapter[]
  fieldCount: number
  missing: Array<{ key: string; label: string }>
  rejected: Array<{ key: string; reason: string }>
  errorMessage: string | null
}) {
  const router = useRouter()
  const [legalName, setLegalName] = useState(suggestedLegalName ?? '')
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {}
    for (const c of chapters) {
      for (const r of c.rows) {
        init[r.key] = {
          accepted: r.confidence >= 0.6,
          value: r.value,
          editing: false,
          showEvidence: false,
        }
      }
    }
    return init
  })
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const acceptedCount = useMemo(
    () => Object.values(rows).filter((r) => r.accepted).length,
    [rows],
  )

  const patchRow = (key: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  const acceptAllHigh = () =>
    setRows((prev) => {
      const next = { ...prev }
      for (const c of chapters) {
        for (const r of c.rows) {
          if (r.confidence >= 0.9) next[r.key] = { ...next[r.key], accepted: true }
        }
      }
      return next
    })

  const checkName = async (name: string) => {
    setLegalName(name)
    if (name.trim().length < 3) {
      setDuplicates([])
      return
    }
    const res = await checkDuplicates({ legalName: name })
    setDuplicates(res.ok ? res.data : [])
  }

  const confirm = async () => {
    setBusy(true)
    setError(null)
    const fields: Array<{ key: string; value: unknown }> = []
    const fieldConfidences: Record<string, number> = {}
    for (const c of chapters) {
      for (const r of c.rows) {
        const state = rows[r.key]
        if (!state?.accepted) continue
        fields.push({ key: r.key, value: state.value })
        fieldConfidences[r.key] = r.confidence
      }
    }
    const res = await confirmExtraction({
      transcriptId,
      legalName: legalName.trim(),
      fields,
      fieldConfidences,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.push(`/intake/${res.data.intakeId}`)
  }

  if (status === 'confirmed' && intakeId != null) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 text-center" data-testid="extraction-confirmed">
        <Check className="mx-auto h-8 w-8 text-status-on-track" aria-hidden />
        <h2 className="mt-3 font-display text-lg font-semibold text-foreground">
          Already confirmed
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This transcript already produced an intake draft.
        </p>
        <Button asChild className="mt-4">
          <Link href={`/intake/${intakeId}`}>Open the intake</Link>
        </Button>
      </div>
    )
  }

  if (status === 'failed' || status === 'uploaded') {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6" data-testid="extraction-failed">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-status-overdue" aria-hidden />
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Extraction {status === 'failed' ? 'failed' : 'did not finish'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {errorMessage ?? 'The transcript was saved but no extraction ran on it.'}
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Button
                onClick={async () => {
                  setBusy(true)
                  const res = await retryExtraction(transcriptId)
                  setBusy(false)
                  if (!res.ok) setError(res.error)
                  else router.refresh()
                }}
                disabled={busy}
                data-testid="retry-extraction"
              >
                {busy ? 'Retrying…' : 'Retry extraction'}
              </Button>
              <Button asChild variant="outline">
                <Link href="/intake">Back to intakes</Link>
              </Button>
            </div>
            {error && (
              <p className="mt-3 text-sm font-medium text-status-overdue" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-10" data-testid="extraction-review">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Review extracted answers
        </h1>
        <p className="text-xs text-muted-foreground">
          {fileName} · extracted with {model ?? 'unknown model'} ·{' '}
          <span className="tnum">{fieldCount}</span> fields · nothing is saved until you confirm.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card" data-testid="legal-name-section">
        <div className="px-4 py-3">
          <label
            htmlFor="extraction-legal-name"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Business legal name
          </label>
          <input
            id="extraction-legal-name"
            data-testid="extraction-legal-name"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            placeholder="Required to create the intake"
            value={legalName}
            onChange={(e) => void checkName(e.target.value)}
          />
          {duplicates.length > 0 && (
            <div
              className="mt-3 rounded-lg border border-status-due-soon bg-status-due-soon-bg p-3"
              role="alert"
              data-testid="duplicate-warning"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-due-soon" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Possible duplicate{duplicates.length === 1 ? '' : 's'} found
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {duplicates.map((d) => (
                      <li key={d.id} className="text-sm text-foreground">
                        <span className="font-medium">{d.dbaName ?? d.legalName}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          matches on {d.matchedOn === 'tax_id' ? 'tax ID (EIN)' : 'business name'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {chapters.length === 0 && (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground" data-testid="no-fields">
          No intake answers were found in this call. You can still create the draft and fill it in
          by hand.
        </p>
      )}

      {chapters.map((chapter) => (
        <section
          key={chapter.id}
          className="rounded-xl border border-border bg-card"
          data-chapter={chapter.id}
          data-testid={`chapter-${chapter.id}`}
        >
          <header className="border-b border-border px-4 py-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {chapter.label}
            </h3>
          </header>
          <ul className="divide-y divide-border px-4">
            {chapter.rows.map((row) => {
              const state = rows[row.key]
              const editable =
                row.kind === 'string' || row.kind === 'number' || row.kind === 'enum' || row.kind === 'boolean'
              return (
                <li key={row.key} className="py-2.5" data-testid={`extract-row-${row.key}`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={state?.accepted ?? false}
                      onChange={(e) => patchRow(row.key, { accepted: e.target.checked })}
                      className="mt-1 h-4 w-4 rounded border-input accent-current"
                      aria-label={`Accept ${row.label}`}
                      data-testid={`accept-${row.key}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-xs text-muted-foreground">{row.label}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <ConfidenceBadge confidence={row.confidence} keyName={row.key} />
                          {editable && (
                            <button
                              type="button"
                              onClick={() => patchRow(row.key, { editing: !state?.editing })}
                              className="inline-flex items-center gap-1 text-xs font-medium text-firm-brand-strong transition-colors hover:text-firm-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                              data-testid={`edit-${row.key}`}
                            >
                              <Pencil className="h-3 w-3" aria-hidden />
                              Edit
                            </button>
                          )}
                        </div>
                      </div>
                      {state?.editing ? (
                        <RowEditor
                          row={row}
                          value={state.value}
                          onChange={(value) => patchRow(row.key, { value })}
                        />
                      ) : (
                        <p
                          className={cn(
                            'mt-0.5 text-sm',
                            state?.accepted ? 'text-foreground' : 'text-muted-foreground line-through',
                          )}
                          data-testid={`value-${row.key}`}
                        >
                          {row.displayValue}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => patchRow(row.key, { showEvidence: !state?.showEvidence })}
                        className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        data-testid={`evidence-${row.key}`}
                        aria-expanded={state?.showEvidence ?? false}
                      >
                        {state?.showEvidence ? (
                          <ChevronDown className="h-3 w-3" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3 w-3" aria-hidden />
                        )}
                        Evidence
                      </button>
                      {state?.showEvidence && (
                        <blockquote
                          className="mt-1 border-l-2 border-border pl-3 text-xs italic text-muted-foreground"
                          data-testid={`evidence-text-${row.key}`}
                        >
                          “{row.evidence}”
                        </blockquote>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {missing.length > 0 && (
        <section className="rounded-xl border border-border bg-card" data-testid="missing-list">
          <header className="border-b border-border px-4 py-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Still to ask the client
            </h3>
          </header>
          <ul className="divide-y divide-border px-4">
            {missing.map((m) => (
              <li key={m.key} className="flex items-center gap-2 py-2 text-sm text-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-status-due-soon" aria-hidden />
                {m.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {rejected.length > 0 && (
        <section className="rounded-xl border border-border bg-card" data-testid="rejected-list">
          <header className="border-b border-border px-4 py-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Dropped by validation ({rejected.length})
            </h3>
          </header>
          <ul className="divide-y divide-border px-4">
            {rejected.map((r, i) => (
              <li key={`${r.key}-${i}`} className="py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{r.key}</span> — {r.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className="text-sm font-medium text-status-overdue" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={acceptAllHigh}
          data-testid="accept-high-confidence"
        >
          Accept all high-confidence
        </Button>
        <div className="flex items-center gap-3">
          <Button asChild variant="outline">
            <Link href="/intake">Cancel</Link>
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={busy || legalName.trim().length === 0}
            data-testid="confirm-extraction"
          >
            {busy ? 'Creating…' : `Create intake with ${acceptedCount} field${acceptedCount === 1 ? '' : 's'}`}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  )
}

function RowEditor({
  row,
  value,
  onChange,
}: {
  row: ExtractionReviewRow
  value: unknown
  onChange: (value: unknown) => void
}) {
  if (row.kind === 'boolean') {
    return (
      <select
        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        value={value === true ? 'yes' : value === false ? 'no' : ''}
        onChange={(e) => onChange(e.target.value === 'yes')}
        data-testid={`edit-input-${row.key}`}
        aria-label={row.label}
      >
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    )
  }
  if (row.kind === 'enum') {
    return (
      <select
        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`edit-input-${row.key}`}
        aria-label={row.label}
      >
        {(row.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  if (row.kind === 'number') {
    return (
      <input
        type="number"
        className="mt-1 h-9 w-28 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        data-testid={`edit-input-${row.key}`}
        aria-label={row.label}
      />
    )
  }
  return (
    <input
      type="text"
      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      data-testid={`edit-input-${row.key}`}
      aria-label={row.label}
    />
  )
}
