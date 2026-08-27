import Link from 'next/link'
import {
  CalendarClock,
  ChartColumn,
  Clock,
  FilePenLine,
  Gauge,
  Percent,
  Scale,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

import type { UserRole } from '@/server/auth/guards'

/**
 * Reports hub link cards. Visibility mirrors the server-side page guards:
 * bookkeepers see only the personal surfaces; managers add team views;
 * admin/owner add payroll and time-edit review.
 */

interface ReportLink {
  href: string
  title: string
  description: string
  Icon: LucideIcon
  roles: readonly UserRole[]
}

const STAFF: readonly UserRole[] = ['owner', 'admin', 'manager', 'bookkeeper']
const MANAGER_UP: readonly UserRole[] = ['owner', 'admin', 'manager']
const ADMIN_UP: readonly UserRole[] = ['owner', 'admin']

const LINKS: ReportLink[] = [
  {
    href: '/reports/my-hours',
    title: 'My hours',
    description: 'Your clocked time by activity and client, plus time-edit requests.',
    Icon: Clock,
    roles: STAFF,
  },
  {
    href: '/reports/my-commission',
    title: 'My commission',
    description: 'Your on-time percentage, tier, and commission for the month.',
    Icon: Percent,
    roles: ['bookkeeper'],
  },
  {
    href: '/reports/hours',
    title: 'Team hours',
    description: 'Per-person hours for a date range - managers see direct reports.',
    Icon: CalendarClock,
    roles: MANAGER_UP,
  },
  {
    href: '/reports/capacity',
    title: 'Staff capacity',
    description: 'Who is overloaded: open work due per week plus clocked vs approved hours.',
    Icon: Gauge,
    roles: MANAGER_UP,
  },
  {
    href: '/reports/commission',
    title: 'Commission',
    description: 'Per-bookkeeper on-time tiers and monthly commission.',
    Icon: ChartColumn,
    roles: MANAGER_UP,
  },
  {
    href: '/reports/profitability',
    title: 'Profitability',
    description: 'Per-client effective hourly rate, labor cost, and margin for the month.',
    Icon: TrendingUp,
    roles: MANAGER_UP,
  },
  {
    href: '/reports/tax',
    title: 'Year-end tax',
    description: 'Per-client year-end checklist completion and the December populate.',
    Icon: Scale,
    roles: STAFF,
  },
  {
    href: '/reports/payroll',
    title: 'Payroll',
    description: 'Semi-monthly pay calculator, payout cadence, and CSV export.',
    Icon: Wallet,
    roles: ADMIN_UP,
  },
  {
    href: '/reports/time-edits',
    title: 'Time edit requests',
    description: 'Approve or reject staff corrections to recorded time.',
    Icon: FilePenLine,
    roles: ADMIN_UP,
  },
]

export function visibleReportLinks(role: UserRole): ReportLink[] {
  return LINKS.filter((l) => l.roles.includes(role))
}

export function ReportsIndex({ role }: { role: UserRole }) {
  const links = visibleReportLinks(role)
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="reports-index">
      {links.map(({ href, title, description, Icon }) => (
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
  )
}
