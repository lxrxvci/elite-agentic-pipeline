import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EmailTemplatesAdmin } from '../email-templates-admin'
import type { EmailTemplateDef } from '@/server/email-template-overrides'

/**
 * K8 audit closeout: the email-templates editor had server-logic pins only.
 * This pins the editor UI itself - select a template, edit subject +
 * closing line, save through the override action; blank restores default.
 */

const setEmailTemplateOverrideAction = vi.fn(async (_key: string, _input: { subject: string | null; footnote: string | null }) => ({
  ok: true as const,
  data: { done: true },
}))
vi.mock('@/server/actions/email-templates', () => ({
  setEmailTemplateOverrideAction: (key: string, input: { subject: string | null; footnote: string | null }) =>
    setEmailTemplateOverrideAction(key, input),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const DEFS: readonly EmailTemplateDef[] = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'quote_ready', label: 'Proposal ready' },
] as unknown as readonly EmailTemplateDef[]

describe('email-templates editor (K3d UI pin)', () => {
  it('edits the subject + closing line and saves through the action', async () => {
    render(
      <EmailTemplatesAdmin
        defs={DEFS}
        overrides={{ quote_ready: { subject: 'Your bookkeeping quote', footnote: null } }}
      />,
    )
    // Switch to the proposal template: its override pre-fills.
    fireEvent.click(screen.getByTestId('email-tab-quote_ready'))
    await waitFor(() => expect(screen.getByLabelText(/subject/i)).toHaveValue('Your bookkeeping quote'))

    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Your custom quote inside' } })
    fireEvent.change(screen.getByLabelText(/closing line/i), { target: { value: 'Reply with questions anytime.' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() =>
      expect(setEmailTemplateOverrideAction).toHaveBeenCalledWith('quote_ready', {
        subject: 'Your custom quote inside',
        footnote: 'Reply with questions anytime.',
      }),
    )
  })

  it('a blank field saves as null (restores the default)', async () => {
    setEmailTemplateOverrideAction.mockClear()
    render(<EmailTemplatesAdmin defs={DEFS} overrides={{ welcome: { subject: 'Hi there', footnote: 'Old line' } }} />)
    // Welcome is the default active tab with its overrides pre-filled.
    await waitFor(() => expect(screen.getByLabelText(/subject/i)).toHaveValue('Hi there'))
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(setEmailTemplateOverrideAction).toHaveBeenCalledWith('welcome', {
        subject: null,
        footnote: 'Old line',
      }),
    )
  })
})
