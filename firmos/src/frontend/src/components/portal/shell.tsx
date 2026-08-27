'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Building2, Check, ChevronsUpDown, LogOut, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { selectPortalClient } from '@/server/actions/portal'
import { authClient } from '@/shared/lib/auth-client'
import { useTheme } from '@/shared/lib/theme'

/**
 * The portal chrome (HANDOFF §12, §30 conv. 10): a slim top bar, deliberately
 * NOT the staff sidebar. Client role gets the six client-scoped destinations
 * plus a business switcher (writes the portal_client_id cookie through the
 * server action); the CPA variant gets the client list only. Every page
 * behind this shell has already been role-gated server-side.
 */

export interface PortalShellClient {
  clientId: number
  clientName: string
  /** §12/§20 - only real-estate clients get the Properties destination. */
  isRealEstateClient?: boolean
  /** §16/§29 - the Chat destination renders only when can_message is on. */
  canMessage?: boolean
}

interface PortalShellProps {
  role: 'client' | 'cpa'
  userName: string
  clients: PortalShellClient[]
  /** Acting client id (client role, after selection). */
  actingClientId: number | null
  children: React.ReactNode
}

interface PortalNavItem {
  href: string
  label: string
  exact?: boolean
}

/**
 * Client-scoped destinations (§12). Properties appears only when the ACTING
 * client is a real-estate client (§20), and Chat only when can_message is on
 * (§16/§29); both pages guard server-side too, so the nav never promises a
 * surface the client cannot use.
 */
function clientNav(isRealEstate: boolean, canMessage: boolean): PortalNavItem[] {
  return [
    { href: '/portal', label: 'Home', exact: true },
    ...(canMessage ? [{ href: '/portal/chat', label: 'Chat' }] : []),
    { href: '/portal/documents', label: 'Documents' },
    { href: '/portal/statements', label: 'Statements' },
    { href: '/portal/reports', label: 'Reports' },
    ...(isRealEstate ? [{ href: '/portal/properties', label: 'Properties' }] : []),
    { href: '/portal/invoices', label: 'Invoices' },
    { href: '/portal/requests', label: 'Requests' },
    { href: '/portal/profile', label: 'Profile' },
  ]
}

const CPA_NAV: PortalNavItem[] = [{ href: '/portal/cpa', label: 'Clients', exact: true }]

function ThemeToggle() {
  const { toggleTheme } = useTheme()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label="Toggle color theme"
      className="h-8 w-8"
    >
      <Sun aria-hidden className="h-4 w-4 dark:hidden" />
      <Moon aria-hidden className="hidden h-4 w-4 dark:block" />
    </Button>
  )
}

function BusinessSwitcher({
  clients,
  actingClientId,
}: {
  clients: PortalShellClient[]
  actingClientId: number | null
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const acting = clients.find((c) => c.clientId === actingClientId) ?? null

  async function choose(clientId: number) {
    if (clientId === actingClientId) return
    setPending(true)
    try {
      const result = await selectPortalClient(clientId)
      if (result.ok) router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          className="h-8 max-w-56 gap-1.5"
          aria-label="Switch business"
        >
          <Building2 aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate">{acting ? acting.clientName : 'Choose a business'}</span>
          <ChevronsUpDown aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your businesses</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {clients.map((client) => (
          <DropdownMenuItem
            key={client.clientId}
            onSelect={() => void choose(client.clientId)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">{client.clientName}</span>
            {client.clientId === actingClientId && (
              <Check aria-hidden className="h-3.5 w-3.5 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function PortalShell({ role, userName, clients, actingClientId, children }: PortalShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [signingOut, setSigningOut] = React.useState(false)
  const actingClient = clients.find((c) => c.clientId === actingClientId) ?? null
  const nav =
    role === 'cpa'
      ? CPA_NAV
      : clientNav(actingClient?.isRealEstateClient === true, actingClient?.canMessage === true)

  async function signOut() {
    setSigningOut(true)
    try {
      await authClient.signOut()
    } finally {
      router.push('/portal/login')
      router.refresh()
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center gap-4 px-6">
          <Link href={role === 'cpa' ? '/portal/cpa' : '/portal'} className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
              F
            </span>
            <span className="font-display text-[15px] font-semibold tracking-tight">FirmOS</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Portal
            </span>
          </Link>

          <nav aria-label="Portal" className="ml-2 hidden items-center gap-1 md:flex">
            {nav.map((item) => {
              const active =
                'exact' in item && item.exact ? pathname === item.href : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {role === 'client' && clients.length > 0 && (
              <BusinessSwitcher clients={clients} actingClientId={actingClientId} />
            )}
            <span className="hidden text-[13px] text-muted-foreground sm:inline">{userName}</span>
            <ThemeToggle />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Sign out"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              <LogOut aria-hidden className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Small screens: the nav drops to a second row. */}
        <nav aria-label="Portal" className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-1.5 md:hidden">
          {nav.map((item) => {
            const active =
              'exact' in item && item.exact ? pathname === item.href : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] font-medium ${
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-6 py-6">{children}</main>
    </div>
  )
}
