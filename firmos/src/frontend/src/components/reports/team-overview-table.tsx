import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { TeamOverviewRow, TeamOverviewReport } from '@/server/capacity'
import { TEAM_CADENCE_KEYS, TEAM_TIER_KEYS } from '@/server/capacity'
import { cn } from '@/shared/lib/utils'

/**
 * Team overview (G5, 02:20:15): per-person completion for the selected
 * range, broken out by client tier (1/2/3) and cadence (monthly, quarterly,
 * semi-annual, annual). Every cell is "done/total" in tabular numerals with
 * a text header - no color-only encodings. Zero cells render a quiet dot so
 * the grid reads as a matrix, not a wall of zeros.
 */

const TIER_LABEL: Record<(typeof TEAM_TIER_KEYS)[number], string> = {
  '1': 'Tier 1',
  '2': 'Tier 2',
  '3': 'Tier 3',
  untiered: 'No tier',
}

const CADENCE_LABEL: Record<(typeof TEAM_CADENCE_KEYS)[number], string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Semi-annual',
  annual: 'Annual',
  other: 'Other',
}

function BucketCell({
  done,
  total,
  label,
  strong = false,
}: {
  done: number
  total: number
  label: string
  strong?: boolean
}) {
  return (
    <TableCell className="tnum px-3 py-2 text-center">
      {total === 0 ? (
        <span className="text-muted-foreground" aria-label={`${label}: no work`}>
          ·
        </span>
      ) : (
        <span
          aria-label={`${label}: ${done} of ${total} done`}
          data-testid="overview-bucket"
          data-done={done}
          data-total={total}
          className={cn(
            'inline-flex items-baseline gap-0.5',
            strong ? 'text-sm font-semibold text-foreground' : 'text-xs text-muted-foreground',
            done === total && 'text-status-on-track',
            done < total && strong && 'text-foreground',
          )}
        >
          {done}
          <span aria-hidden className="text-muted-foreground/60">
            /
          </span>
          {total}
        </span>
      )}
    </TableCell>
  )
}

export function TeamOverviewTable({ report }: { report: TeamOverviewReport }) {
  const rows: TeamOverviewRow[] = report.rows
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 px-4 text-[11px] font-semibold uppercase tracking-wider">
              Team member
            </TableHead>
            <TableHead className="h-9 px-3 text-center text-[11px] font-semibold uppercase tracking-wider">
              All work
            </TableHead>
            {TEAM_TIER_KEYS.map((t) => (
              <TableHead
                key={t}
                className="h-9 px-3 text-center text-[11px] font-semibold uppercase tracking-wider"
              >
                {TIER_LABEL[t]}
              </TableHead>
            ))}
            {TEAM_CADENCE_KEYS.map((c) => (
              <TableHead
                key={c}
                className="h-9 px-3 text-center text-[11px] font-semibold uppercase tracking-wider"
              >
                {CADENCE_LABEL[c]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={TEAM_TIER_KEYS.length + TEAM_CADENCE_KEYS.length + 2}
                className="px-4 py-6 text-center text-xs text-muted-foreground"
              >
                No staff in scope.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.userId} data-testid="team-overview-row">
                <TableCell className="px-4 py-2">
                  <span className="text-sm font-medium text-foreground">{row.name}</span>
                  <span className="ml-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {row.role}
                  </span>
                </TableCell>
                <BucketCell
                  done={row.totals.done}
                  total={row.totals.total}
                  label={`${row.name}, all work`}
                  strong
                />
                {TEAM_TIER_KEYS.map((t) => (
                  <BucketCell
                    key={t}
                    done={row.byTier[t].done}
                    total={row.byTier[t].total}
                    label={`${row.name}, ${TIER_LABEL[t]}`}
                  />
                ))}
                {TEAM_CADENCE_KEYS.map((c) => (
                  <BucketCell
                    key={c}
                    done={row.byCadence[c].done}
                    total={row.byCadence[c].total}
                    label={`${row.name}, ${CADENCE_LABEL[c]}`}
                  />
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
