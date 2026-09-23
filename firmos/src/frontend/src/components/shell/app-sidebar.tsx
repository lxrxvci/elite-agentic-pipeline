'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/shared/lib/utils'

import { ADMIN_ITEM, NAV_ITEMS, type NavItem } from './nav'

interface AppSidebarProps {
  collapsed: boolean
  onToggle: () => void
  /** Normalized (lowercase) staff role - gates role-restricted nav items. */
  role: string
  /** Total unread chat messages, fed by a server read in the (app) layout. */
  chatUnread?: number
}

function NavBadge({ count }: { count: number }) {
  return (
    <span className="tnum ml-auto rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold text-firm-rail-text">
      {count}
    </span>
  )
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname()
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`)

  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors duration-150 ease-out',
        active
          ? 'bg-firm-rail-active font-semibold text-firm-rail-text'
          : 'text-firm-rail-text/85 hover:bg-firm-rail-hover hover:text-firm-rail-text',
        collapsed && 'justify-center px-0',
      )}
    >
      <item.icon aria-hidden className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.title}</span>}
      {!collapsed && item.badge != null && item.badge > 0 && <NavBadge count={item.badge} />}
    </Link>
  )

  if (!collapsed) return link

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {item.title}
        {item.badge != null && item.badge > 0 ? ` (${item.badge})` : ''}
      </TooltipContent>
    </Tooltip>
  )
}

export function AppSidebar({ collapsed, onToggle, role, chatUnread }: AppSidebarProps) {
  const items = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role)).map(
    (item) => (item.href === '/messages' ? { ...item, badge: chatUnread } : item),
  )
  return (
    <aside
      className={cn(
        // The FreshBooks brand rail: deep blue gradient, white text, darker
        // active pill. Stays blue in dark mode (docs/DESIGN-FRESHBOOKS.md §1).
        'sticky top-0 flex h-screen shrink-0 flex-col bg-[linear-gradient(180deg,var(--firm-rail),var(--firm-rail-deep))] text-firm-rail-text transition-[width] duration-200 ease-out',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          'flex h-12 items-center gap-2 border-b border-white/10 px-3',
          collapsed && 'justify-center px-0',
        )}
      >
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-[13px] font-bold text-firm-rail-deep"
        >
          F
        </span>
        {!collapsed && (
          <span className="font-display text-[15px] font-bold tracking-tight text-firm-rail-text">
            FirmOS
          </span>
        )}
      </div>

      {/* Primary nav */}
      <nav aria-label="Primary" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {items.map((item) => (
          <SidebarLink key={item.href} item={item} collapsed={collapsed} />
        ))}
      </nav>

      {/* Admin (admin/owner only) + collapse, pinned to the bottom */}
      <div className="space-y-1 px-2 pb-2">
        <div aria-hidden className="mx-2 mb-2 h-px bg-white/10" />
        {(role === 'admin' || role === 'owner') && (
          <SidebarLink item={ADMIN_ITEM} collapsed={collapsed} />
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-firm-rail-text/85 transition-colors duration-150 ease-out hover:bg-firm-rail-hover hover:text-firm-rail-text',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden className="h-4 w-4 shrink-0" />
          ) : (
            <>
              <PanelLeftClose aria-hidden className="h-4 w-4 shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
