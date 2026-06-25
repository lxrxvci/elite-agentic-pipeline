'use client'

import { useState } from 'react'
import { FoodcartLayout } from '@/widgets/FoodcartLayout/FoodcartLayout'
import { AdminProtectedRoute } from '@/features/auth/ui/AdminProtectedRoute'
import { AIAssistantPanel, type ChatMessage, type ChangePreview } from '@/shared/ui'
import { useTenant } from '../api/useTenant'
import { useSites } from '../api/useSites'
import { useAIPropose } from '@/features/assistant/api/useAIPropose'
import { useAIApply } from '@/features/assistant/api/useAIApply'

interface DashboardShellProps {
  children: React.ReactNode
}

export function DashboardShell({ children }: DashboardShellProps) {
  const { data: tenant } = useTenant()
  const { data: sites } = useSites()
  const siteId = sites?.[0]?.id
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [preview, setPreview] = useState<ChangePreview | null>(null)
  const [proposalId, setProposalId] = useState<string | null>(null)
  const [guardrailError, setGuardrailError] = useState<string | null>(null)
  const propose = useAIPropose(siteId)
  const apply = useAIApply(siteId)

  const handleSend = async (text: string) => {
    setGuardrailError(null)
    setPreview(null)
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    try {
      const result = await propose.mutateAsync({ prompt: text })
      setMessages((prev) => [...prev, { role: 'assistant', content: result.summary }])
      if (!result.in_scope) {
        setGuardrailError('I can only update menu, hours, story, hero, links, or catering.')
        return
      }
      setProposalId(result.proposal_id)
      setPreview({
        summary: result.summary,
        added: result.operations.filter((o) => o.op === 'add' || o.op === 'replace').map((o) => `${o.path}`),
        removed: result.operations.filter((o) => o.op === 'remove').map((o) => `${o.path}`),
      })
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Sorry, something went wrong. ${e instanceof Error ? e.message : ''}` }])
    }
  }

  const handleApprove = async () => {
    if (!preview || !proposalId) return
    await apply.mutateAsync({ proposal_id: proposalId, confirmed: true })
    setPreview(null)
    setProposalId(null)
    setMessages((prev) => [...prev, { role: 'assistant', content: 'Changes applied and saved as a new revision.' }])
  }

  const handleReject = () => {
    setPreview(null)
    setMessages((prev) => [...prev, { role: 'assistant', content: 'No problem — tell me what to change instead.' }])
  }

  return (
    <AdminProtectedRoute>
      <div className="relative">
        <FoodcartLayout tenantName={tenant?.name} onToggleAssistant={() => setAssistantOpen((v) => !v)}>
          {children}
        </FoodcartLayout>
        <AIAssistantPanel
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          messages={messages}
          preview={preview}
          loading={propose.isPending}
          guardrailError={guardrailError}
          onSend={handleSend}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      </div>
    </AdminProtectedRoute>
  )
}
