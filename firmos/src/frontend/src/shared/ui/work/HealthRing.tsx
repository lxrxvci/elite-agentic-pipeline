'use client'

import { WorkStatus, workStatusConfig } from './WorkStatusBadge'

/**
 * Client health ring — Yecny's health score made glanceable.
 * Color follows the status contract; the number is the score (0–100).
 */
export function HealthRing({
  score,
  status,
  size = 44,
}: {
  score: number
  status: WorkStatus
  size?: number
}) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c
  const colorVar = `var(--status-${status.replace('_', '-')})`

  return (
    <div
      className="relative inline-flex items-center justify-center"
      role="img"
      aria-label={`Client health ${score} of 100`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--firm-border)"
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colorVar}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
        />
      </svg>
      <span className="tnum absolute text-[11px] font-bold" style={{ color: colorVar }}>
        {score}
      </span>
    </div>
  )
}

export { workStatusConfig }
