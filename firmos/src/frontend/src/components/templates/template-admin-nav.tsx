'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/shared/lib/utils'

/**
 * Sub-nav for the six template systems (§19). Standalone - mounted directly
 * under /admin until the admin workstream's layout absorbs these pages.
 */

const LINKS = [
  { href: '/admin/templates', label: 'Overview', exact: true },
  { href: '/admin/templates/sops', label: 'SOPs' },
  { href: '/admin/templates/recurring', label: 'Recurring' },
  { href: '/admin/templates/onboarding', label: 'Onboarding' },
  { href: '/admin/templates/offboarding', label: 'Offboarding' },
  { href: '/admin/templates/adhoc', label: 'Ad-hoc' },
  { href: '/admin/templates/projects', label: 'Projects' },
] as const

export function TemplateAdminNav() {
  const pathname = usePathname()
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Template systems" data-testid="template-admin-nav">
      {LINKS.map((link) => {
        const active = 'exact' in link && link.exact ? pathname === link.href : pathname.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
