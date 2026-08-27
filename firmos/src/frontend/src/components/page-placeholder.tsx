import type { LucideIcon } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'

interface PagePlaceholderProps {
  title: string
  /** One line: what this surface will do. */
  description: string
  icon: LucideIcon
  empty: {
    title: string
    description: string
    actionLabel?: string
    actionMessage?: string
  }
}

/** Phase-1 surface placeholder: real page chrome, honest empty state. */
export function PagePlaceholder({ title, description, icon: Icon, empty }: PagePlaceholderProps) {
  return (
    <div>
      <header>
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>
      <div className="mt-6">
        <EmptyState
          icon={<Icon aria-hidden />}
          title={empty.title}
          description={empty.description}
          actionLabel={empty.actionLabel}
          actionMessage={empty.actionMessage}
        />
      </div>
    </div>
  )
}
