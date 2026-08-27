'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DollarSign, FileClock, Flag, Layers, MessageSquareWarning, ShieldAlert, Trash2, Users } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

/**
 * /admin sub-navigation. One tab per admin surface; active state via aria-
 * current plus the accent treatment, never color alone.
 */
const ITEMS = [
  { title: 'Users', href: '/admin/users', icon: Users },
  { title: 'Purgatory', href: '/admin/purgatory', icon: ShieldAlert },
  { title: 'Trash', href: '/admin/trash', icon: Trash2 },
  { title: 'Audit log', href: '/admin/audit', icon: FileClock },
  { title: 'Pricing', href: '/admin/pricing', icon: DollarSign },
  { title: 'Settings', href: '/admin/settings', icon: Flag },
  { title: 'Feedback', href: '/admin/feedback', icon: MessageSquareWarning },
  { title: 'Templates', href: '/admin/templates', icon: Layers },
] as const

export function AdminSubNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Admin sections" className="flex flex-wrap items-center gap-1">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors duration-150 ease-out',
              active
                ? 'bg-accent font-semibold text-accent-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            <item.icon aria-hidden className="h-3.5 w-3.5" />
            {item.title}
          </Link>
        )
      })}
    </nav>
  )
}
