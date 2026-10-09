'use client'

import * as React from 'react'
import { toast } from 'sonner'

import { setUserSkillAction } from '@/server/actions/user-skills'
import { SKILL_TIERS, type UserSkillRow } from '@/shared/lib/user-skills'

/**
 * L6 (I6, 10_06 00:51:01): the skill-tree editor on /admin/settings. Each
 * staff user gets a manual 1-5 level per difficulty tier (the L3 pricing
 * tiers). Levels are the data the later workload/skill recommender reads -
 * nothing auto-assigns from them yet. Saves per cell, admin/owner only.
 */
export function UserSkillsAdmin({
  staff,
  rows,
}: {
  staff: { id: number; name: string }[]
  rows: UserSkillRow[]
}) {
  // userId -> tier -> level ('' = unset)
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const r of rows) map[`${r.userId}:${r.tier}`] = String(r.level)
    return map
  })
  const [busyCell, setBusyCell] = React.useState<string | null>(null)

  async function setCell(userId: number, tier: string, level: string) {
    const key = `${userId}:${tier}`
    if (level === '') {
      // Clearing a level is not a write this wave (no delete path yet) -
      // leave the stored row untouched.
      setValues((v) => ({ ...v, [key]: '' }))
      return
    }
    setValues((v) => ({ ...v, [key]: level }))
    setBusyCell(key)
    const res = await setUserSkillAction(userId, tier, Number(level))
    setBusyCell(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Skill level saved.')
  }

  return (
    <section className="rounded-xl border border-border bg-card" data-testid="user-skills-admin">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Team skill levels</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Manual 1-5 proficiency per difficulty tier (bookkeeper / manager / owner work). The
          scheduling recommender reads these later - nothing auto-assigns from them yet.
        </p>
      </header>
      <div className="overflow-x-auto px-4 py-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 pr-4 font-semibold">Team member</th>
              {SKILL_TIERS.map((t) => (
                <th key={t} className="pb-2 pr-4 font-semibold capitalize">
                  {t} work
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {staff.map((s) => (
              <tr key={s.id} data-testid={`skill-row-${s.id}`}>
                <td className="py-2 pr-4 text-foreground">{s.name}</td>
                {SKILL_TIERS.map((t) => {
                  const key = `${s.id}:${t}`
                  return (
                    <td key={t} className="py-2 pr-4">
                      <select
                        aria-label={`${s.name} - ${t} level`}
                        data-testid={`skill-${s.id}-${t}`}
                        className="h-8 w-20 appearance-none rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                        value={values[key] ?? ''}
                        disabled={busyCell === key}
                        onChange={(e) => void setCell(s.id, t, e.target.value)}
                      >
                        <option value="">-</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
