'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'

interface FoodcartLayoutProps {
  children: React.ReactNode
  tenantName?: string
  onToggleAssistant?: () => void
}

const NAV = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/dashboard/business', label: 'Business info' },
  { href: '/admin/dashboard/hours', label: 'Hours' },
  { href: '/admin/dashboard/links', label: 'Links' },
  { href: '/admin/dashboard/appearance', label: 'Appearance' },
]

export function FoodcartLayout({ children, tenantName, onToggleAssistant }: FoodcartLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const pathname = usePathname()
  const { signOut } = useClerk()

  return (
    <div className="min-h-screen bg-fc-neutral-50 flex flex-col">
      <header className="h-16 bg-white border-b border-fc-neutral-200 flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard" className="font-display font-bold text-xl text-fc-text-primary">
            WebAgentic
          </Link>
          {tenantName && <span className="hidden md:inline text-sm text-fc-text-secondary">{tenantName}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleAssistant}
            className="hidden md:inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold text-fc-text-primary hover:bg-fc-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fc-cobalt-500"
          >
            🤖 AI Assistant
          </button>
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            className="md:hidden p-2 rounded-md text-fc-text-primary"
            aria-label="Toggle navigation"
            aria-expanded={mobileNavOpen}
          >
            ☰
          </button>
          <button
            type="button"
            onClick={() => signOut({ redirectUrl: '/admin/login' })}
            className="text-sm font-semibold text-fc-text-secondary hover:text-fc-text-primary px-3 py-2"
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className={`${mobileNavOpen ? 'block' : 'hidden'} md:block w-64 bg-white border-r border-fc-neutral-200 p-4`}>
          <nav aria-label="Admin">
            <ul className="space-y-1">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block rounded-lg px-3 py-2 text-sm font-semibold ${pathname === item.href ? 'bg-fc-cobalt-50 text-fc-cobalt-700' : 'text-fc-text-secondary hover:bg-fc-neutral-50'}`}
                    aria-current={pathname === item.href ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main className="flex-1 min-w-0 p-4 md:p-8">{children}</main>
      </div>
    </div>
  )
}
