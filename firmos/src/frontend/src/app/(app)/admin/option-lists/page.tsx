import { OptionListsAdmin } from '@/components/admin/option-lists-admin'
import { requireStaff, type SessionUser } from '@/server/auth/guards'
import { listOptionValues, OPTION_LISTS } from '@/server/option-lists'

export const metadata = { title: 'FirmOS - Option Lists' }
export const dynamic = 'force-dynamic'

function canManageOptions(user: SessionUser): boolean {
  return user.normalizedRole === 'owner' || user.normalizedRole === 'admin'
}

/** K3 (J16): the option-lists manager - every reusable list, admin-managed. */
export default async function OptionListsPage() {
  const user = await requireStaff()
  const lists = await Promise.all(
    Object.values(OPTION_LISTS).map(async (def) => ({
      key: def.key,
      label: def.label,
      noun: def.noun,
      values: await listOptionValues(def.key, true),
    })),
  )

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">Option lists</h1>
        <p className="text-xs text-muted-foreground">
          Every reusable dropdown and chip list in the app. Anything added during an intake lands here for
          future use - rename or hide entries without losing history.
        </p>
      </div>
      <OptionListsAdmin lists={lists} canManage={canManageOptions(user)} />
    </div>
  )
}
