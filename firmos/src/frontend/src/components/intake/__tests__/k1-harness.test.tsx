import { readFileSync } from 'node:fs'
import path from 'node:path'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'
import {
  OVERLAY_CURSOR_MARGIN_X,
  OVERLAY_CURSOR_MARGIN_Y,
  snapOverlayToCursor,
} from '../routine-scheduler'

/**
 * K1 (meeting 09_30) harness pins that don't fit an existing suite:
 *  - J9 pointer-hand cursor on anything clickable (globals.css rule)
 *  - J10 no AI/internal jargon in UI copy (registry source scan)
 *  - E2 the drag overlay tracks the pointer grab point (modifier math)
 */

describe('J9: clickables_have_pointer_cursor', () => {
  it('globals.css carries the pointer rule for interactive roles', () => {
    const css = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8')
    expect(css).toContain("button:not(:disabled)")
    expect(css).toContain("[role='button']")
    expect(css).toContain('cursor: pointer')
  })
})

describe('J10: no_internal_jargon_in_copy', () => {
  it('the registry never leaks build-speak into user-facing copy', () => {
    const raw = readFileSync(path.resolve(__dirname, '../registry.ts'), 'utf8')
    // Scan USER-FACING copy only: strip // and block comments first (the
    // phrases are fine in dev notes, never in title/help/body strings).
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    // The phrases Jason read out loud as "definitely some AI jargon"
    // (09_30 00:25:18) and their siblings. K8: the seat-count and
    // engagement-seeds constructions join the ban list.
    for (const banned of [
      'rides the',
      'this answer seeds',
      'conversion seeds',
      'seats the task',
      'this engagement seeds',
      'Seats drive',
      'seat count',
    ]) {
      expect(src).not.toContain(banned)
    }
  })

  it('jargon_scan_covers_all_intake_copy (L1, 10_06): every user-facing intake file scans clean', () => {
    const files = [
      '../screens.tsx',
      '../review-screen.tsx',
      '../account-screens.tsx',
      '../routine-scheduler.tsx',
      '../routine-calendar.tsx',
      '../custom-work.tsx',
      '../note-on-yes-panel.tsx',
      '../quote-template-button.tsx',
      '../edit-overlay.tsx',
      '../new-intake-button.tsx',
    ]
    for (const rel of files) {
      const raw = readFileSync(path.resolve(__dirname, rel), 'utf8')
      const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n')
      for (const banned of [
        'rides the',
        'this answer seeds',
        'conversion seeds',
        'seats the task',
        'this engagement seeds',
        'Seats drive',
        'seat count',
      ]) {
        expect(src, `${rel} must not contain "${banned}"`).not.toContain(banned)
      }
    }
  })
})

describe('E2: drag_overlay_tracks_pointer (09_30 00:51:38)', () => {
  const rect = { left: 100, top: 200, width: 640, height: 56, right: 740, bottom: 256 }

  it('shifts the overlay so its top-left sits the margin up-left of the cursor', () => {
    // Grabbed 320px in / 20px down a full-width card; dragged (+50, +30).
    const out = snapOverlayToCursor({
      activatorEvent: { clientX: 420, clientY: 220 } as unknown as Event,
      draggingNodeRect: rect as unknown as DOMRect,
      transform: { x: 50, y: 30, scaleX: 1, scaleY: 1 },
    } as unknown as Parameters<typeof snapOverlayToCursor>[0])
    // Overlay left = rect.left + x = current-cursor.x - margin, where the
    // current cursor is the grab point plus the drag delta (420+50 - 20).
    expect(out.x).toBe(420 + 50 - OVERLAY_CURSOR_MARGIN_X - rect.left)
    expect(out.y).toBe(220 + 30 - OVERLAY_CURSOR_MARGIN_Y - rect.top)
    expect(out.scaleX).toBe(1)
    expect(OVERLAY_CURSOR_MARGIN_X).toBe(20)
  })

  it('a grab at the card edge keeps the overlay at the cursor too', () => {
    const out = snapOverlayToCursor({
      activatorEvent: { clientX: 108, clientY: 204 } as unknown as Event,
      draggingNodeRect: rect as unknown as DOMRect,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    } as unknown as Parameters<typeof snapOverlayToCursor>[0])
    expect(out.x).toBe((108 - OVERLAY_CURSOR_MARGIN_X) - rect.left)
    expect(out.y).toBe((204 - OVERLAY_CURSOR_MARGIN_Y) - rect.top)
  })

  it('passes the transform through untouched without a rect or event', () => {
    const transform = { x: 5, y: 6, scaleX: 1, scaleY: 1 }
    const out = snapOverlayToCursor({
      activatorEvent: null,
      draggingNodeRect: null,
      transform,
    } as unknown as Parameters<typeof snapOverlayToCursor>[0])
    expect(out).toBe(transform)
  })
})

describe('E7: descriptions_fully_visible (09_30 00:57:44)', () => {
  const q = findQuestion('recurring', 'routine-scheduler')!
  const base: WizardAnswers = {
    legalName: 'Test Co',
    engagementType: 'bookkeeping',
    quickbooksStatus: 'existing',
    bookkeepingFrequency: 'monthly',
    monthlyCloseTier: '10',
    bookkeepingStartDate: '2026-08-01',
  }

  function Harness({ initial, question = q }: { initial: WizardAnswers; question?: QuestionDef }) {
    const [answers, setAnswers] = useState<WizardAnswers>(initial)
    return (
      <QuestionScreen
        q={question}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={() => {}}
        onPickOption={() => {}}
      />
    )
  }

  it('schedule summaries never carry a truncation class', () => {
    render(<Harness initial={base} />)
    const summaries = screen.getAllByTestId(/^schedule-summary-/)
    expect(summaries.length).toBeGreaterThan(0)
    for (const el of summaries) {
      expect(el.className).not.toContain('truncate')
    }
  })
})

describe('A7: continue_with_unadded_draft_prompts_save_or_discard (09_30 00:38:21)', () => {
  const ownersQ = findQuestion('entity', 'owners')!

  function Harness({ initial, onAdvance }: { initial: WizardAnswers; onAdvance: () => void }) {
    const [answers, setAnswers] = useState<WizardAnswers>(initial)
    return (
      <div>
        <QuestionScreen
          q={ownersQ}
          answers={answers}
          onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
          onAdvance={onAdvance}
          onPickOption={() => {}}
        />
        <pre data-testid="answers">{JSON.stringify(answers)}</pre>
      </div>
    )
  }

  // S Corp (≥1 owner, no max): one committed owner passes validateItems, so
  // the discard path is free to advance.
  const base: WizardAnswers = { taxStructure: 'S Corporation', owners: [{ name: 'Wren Okafor', ownershipPercent: 50 }] }

  it('Continue with a typed-but-unadded draft asks; never silently commits', () => {
    const onAdvance = vi.fn()
    render(<Harness initial={base} onAdvance={onAdvance} />)
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Sal Vega' } })

    fireEvent.click(screen.getByTestId('continue'))
    expect(screen.getByTestId('unsaved-draft-dialog')).toBeInTheDocument()
    expect(onAdvance).not.toHaveBeenCalled()
    // The draft is NOT silently on the list (the 00:23:52 processor bug).
    expect(screen.getAllByTestId('entity-chip')).toHaveLength(1)

    // Go back keeps editing, draft intact, dialog gone.
    fireEvent.click(screen.getByTestId('unsaved-draft-back'))
    expect(screen.queryByTestId('unsaved-draft-dialog')).toBeNull()
    expect(screen.getByLabelText('Full name')).toHaveValue('Sal Vega')

    // Don't save: advances with the list as-was.
    fireEvent.click(screen.getByTestId('continue'))
    fireEvent.click(screen.getByTestId('unsaved-draft-discard'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
    expect(JSON.parse(screen.getByTestId('answers').textContent ?? '{}').owners).toHaveLength(1)
  })

  it('Save and continue commits the draft onto the list, then advances', () => {
    const onAdvance = vi.fn()
    render(<Harness initial={base} onAdvance={onAdvance} />)
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Sal Vega' } })
    fireEvent.click(screen.getByTestId('continue'))
    fireEvent.click(screen.getByTestId('unsaved-draft-save'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
    const owners = JSON.parse(screen.getByTestId('answers').textContent ?? '{}').owners as Array<{ name: string }>
    expect(owners.map((o) => o.name)).toEqual(['Wren Okafor', 'Sal Vega'])
  })

  it('an invalid draft still blocks with the plain message (no dialog)', () => {
    const onAdvance = vi.fn()
    render(<Harness initial={{ taxStructure: 'Partnership', owners: [] }} onAdvance={onAdvance} />)
    // Required name only - percent is optional, so one letter is a valid
    // draft; an EMPTY name with a percent typed is invalid.
    fireEvent.change(screen.getByLabelText(/Ownership %/), { target: { value: '40' } })
    fireEvent.click(screen.getByTestId('continue'))
    expect(screen.queryByTestId('unsaved-draft-dialog')).toBeNull()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(onAdvance).not.toHaveBeenCalled()
  })
})
