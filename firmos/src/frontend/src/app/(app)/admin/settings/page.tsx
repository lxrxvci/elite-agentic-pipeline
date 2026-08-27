import type { Metadata } from 'next'

import { SettingsForm } from '@/components/admin/settings-form'
import { getAdminSettings } from '@/server/admin-reads'
import { requireRole } from '@/server/auth/guards'

export const metadata: Metadata = { title: 'FirmOS - Admin - Settings' }

/**
 * /admin/settings - the §27 settings inventory backed by app_settings. Every
 * save is admin/owner-only and audit-logged through the action layer.
 */
export default async function AdminSettingsPage() {
  await requireRole('admin', 'owner')
  const settings = await getAdminSettings()
  return <SettingsForm settings={settings} />
}
