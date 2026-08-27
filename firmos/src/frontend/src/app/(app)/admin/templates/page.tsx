import Link from 'next/link'
import {
  BookOpen,
  CalendarSync,
  ClipboardList,
  DoorOpen,
  Layers,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

import { TemplateAdminNav } from '@/components/templates/template-admin-nav'
import { requireStaff } from '@/server/auth/guards'

export const metadata = { title: 'FirmOS - Template Admin' }
export const dynamic = 'force-dynamic'

/**
 * Template admin hub (§19): the six template systems. Each system page
 * respects its §11 permission flag - read-only without it.
 */

const SYSTEMS: { href: string; title: string; description: string; Icon: LucideIcon }[] = [
  {
    href: '/admin/templates/sops',
    title: 'SOPs',
    description: 'Firm standard procedures. Edits propagate to every linked client manual entry.',
    Icon: BookOpen,
  },
  {
    href: '/admin/templates/recurring',
    title: 'Recurring',
    description: 'The Reconcile / Categorize / Client Questions / Send Reports rules, applied at onboarding.',
    Icon: CalendarSync,
  },
  {
    href: '/admin/templates/onboarding',
    title: 'Onboarding',
    description: 'Checklist copied onto each client at intake conversion, admin phase first.',
    Icon: ClipboardList,
  },
  {
    href: '/admin/templates/offboarding',
    title: 'Offboarding',
    description: 'Tasks spawned when offboarding starts; completion deactivates the client.',
    Icon: DoorOpen,
  },
  {
    href: '/admin/templates/adhoc',
    title: 'Ad-hoc',
    description: 'One-shot task definitions. "Create task" mints a single task onto a client.',
    Icon: Sparkles,
  },
  {
    href: '/admin/templates/projects',
    title: 'Projects',
    description: 'Project checklists with prerequisite chains, spawned at project creation.',
    Icon: Layers,
  },
]

export default async function TemplateAdminPage() {
  await requireStaff()

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Templates
        </h1>
        <p className="text-xs text-muted-foreground">
          The firm&apos;s six template systems - what every client inherits.
        </p>
      </div>
      <TemplateAdminNav />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="template-admin-index">
        {SYSTEMS.map(({ href, title, description, Icon }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border border-border bg-card p-4 transition-colors duration-150 hover:border-foreground/20 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors duration-150 group-hover:text-foreground">
                <Icon aria-hidden className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-semibold text-foreground">{title}</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
