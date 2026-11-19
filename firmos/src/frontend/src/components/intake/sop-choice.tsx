'use client'

import { SearchSelect } from '@/components/ui/search-select'

export type SopStatus = 'existing' | 'create' | 'unsure'

export function SopChoiceFields({
  label,
  status,
  sopTemplateId,
  sops,
  onChange,
}: {
  label: string
  status: SopStatus | null | undefined
  sopTemplateId?: number | null
  sops: { id: number; title: string }[]
  onChange: (patch: { sopStatus: SopStatus | null; sopTemplateId: number | null }) => void
}) {
  return (
    <div className="space-y-3">
      <SearchSelect
        ariaLabel={label}
        value={status ?? null}
        options={[
          { id: 'existing', label: 'Use existing SOP', data: null },
          { id: 'create', label: 'Create new SOP', data: null },
          { id: 'unsure', label: 'I’m not sure', data: null },
        ]}
        onChange={(id) => onChange({ sopStatus: id as SopStatus, sopTemplateId: id === 'existing' ? sopTemplateId ?? null : null })}
        placeholder="Choose how to handle the SOP…"
      />
      {status === 'existing' && (
        <SearchSelect
          ariaLabel={`Existing SOP for ${label}`}
          value={sopTemplateId == null ? null : String(sopTemplateId)}
          options={[...sops].sort((a, b) => a.title.localeCompare(b.title)).map((sop) => ({ id: String(sop.id), label: sop.title, data: null }))}
          onChange={(id) => onChange({ sopStatus: 'existing', sopTemplateId: id == null ? null : Number(id) })}
          placeholder="Search existing SOPs…"
        />
      )}
      {(status === 'create' || status === 'unsure') && (
        <p className="text-sm text-muted-foreground">{status === 'create' ? 'A task to create this SOP will be added at setup.' : 'A task to ask the client about this SOP will be added at setup.'}</p>
      )}
    </div>
  )
}
