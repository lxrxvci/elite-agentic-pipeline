import {
  ChartColumn,
  ContactRound,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LayoutGrid,
  MessagesSquare,
  Receipt,
  ShieldCheck,
  StickyNote,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
  /** Unread/count badge. Hidden when undefined or 0. */
  badge?: number
  /** Staff roles that see the item. Undefined = every staff role. */
  roles?: readonly string[]
}

/** Primary surfaces, in mandated order. Admin lives separately at the bottom. */
export const NAV_ITEMS: NavItem[] = [
  { title: 'Workstation', href: '/workstation', icon: LayoutDashboard },
  { title: 'Progress', href: '/progress', icon: LayoutGrid },
  { title: 'Messages', href: '/messages', icon: MessagesSquare },
  { title: 'Clients', href: '/clients', icon: Users },
  { title: 'Client Intake', href: '/intake', icon: UserPlus },
  { title: 'Contacts', href: '/contacts', icon: ContactRound },
  { title: 'Invoices', href: '/invoices', icon: Receipt, roles: ['owner', 'admin', 'manager'] },
  { title: 'Projects', href: '/projects', icon: FolderKanban },
  { title: 'Notes', href: '/notes', icon: StickyNote },
  { title: 'Reports', href: '/reports', icon: ChartColumn },
  { title: 'Statements', href: '/statements', icon: FileText },
]

export const ADMIN_ITEM: NavItem = {
  title: 'Admin',
  href: '/admin',
  icon: ShieldCheck,
}
