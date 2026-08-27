'use client'

import * as React from 'react'

import { TooltipProvider } from '@/components/ui/tooltip'

import { AppSidebar } from './app-sidebar'
import { TopBar } from './top-bar'

/**
 * Authenticated app chrome: collapsible sidebar + top bar + content outlet.
 * Lives above every (app) route, so the collapsed state survives navigation.
 */
export function AppShell({
  role,
  chatUnread,
  children,
}: {
  role: string
  chatUnread?: number
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = React.useState(false)

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-background">
        <AppSidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
          role={role}
          chatUnread={chatUnread}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  )
}
