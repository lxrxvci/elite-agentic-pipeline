'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageSquarePlus, Moon, Sun } from 'lucide-react'

import { FeedbackDialog } from '@/components/admin/feedback-dialog'
import { NotificationsBell } from '@/components/notifications/bell-menu'
import { QuickAddMenu, type QuickAddKind } from '@/components/quick-add/quick-add-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { useTheme } from '@/shared/lib/theme'
import { authClient } from '@/shared/lib/auth-client'

import { ClockWidget } from './clock-widget'
import { CommandMenu, SearchTrigger } from './command-menu'

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
      {/* Pure-CSS swap: no hydration flash, no icon flicker */}
      <Sun aria-hidden className="h-4 w-4 dark:hidden" />
      <Moon aria-hidden className="hidden h-4 w-4 dark:block" />
    </Button>
  )
}

function NotificationsMenu() {
  return <NotificationsBell />
}

function UserMenu() {
  const router = useRouter()
  const [signingOut, setSigningOut] = React.useState(false)
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)

  async function signOut() {
    setSigningOut(true)
    try {
      await authClient.signOut()
    } finally {
      router.push('/login')
      router.refresh()
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-primary text-[11px] font-semibold text-primary-foreground">
                YB
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>
            <p className="text-[13px] font-medium">Yecny Bookkeeping</p>
            <p className="text-xs font-normal text-muted-foreground">Practice account</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setFeedbackOpen(true)}>
            <MessageSquarePlus aria-hidden className="mr-2 h-3.5 w-3.5" />
            Send feedback
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/account/security">Security settings</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={signingOut}
            onSelect={(e) => {
              e.preventDefault()
              void signOut()
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  )
}

export function TopBar() {
  const [commandOpen, setCommandOpen] = React.useState(false)
  const [quickAddDialog, setQuickAddDialog] = React.useState<QuickAddKind | null>(null)

  return (
    <>
      <header className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
        <SearchTrigger onOpen={() => setCommandOpen(true)} />
        <div className="ml-auto flex items-center gap-1">
          <QuickAddMenu dialog={quickAddDialog} onDialogChange={setQuickAddDialog} />
          <ClockWidget />
          <Separator orientation="vertical" className="mx-1.5 h-5" />
          <NotificationsMenu />
          <ThemeToggle />
          <Separator orientation="vertical" className="mx-1.5 h-5" />
          <UserMenu />
        </div>
      </header>
      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onQuickAdd={(kind) => setQuickAddDialog(kind)}
      />
    </>
  )
}
