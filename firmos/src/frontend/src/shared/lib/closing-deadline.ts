import type { CloseTier } from '@firmos/domain'

export const MAX_CLOSE_DAYS_AFTER_END = 365

export interface ClosingDeadlineAnswers {
  monthlyCloseTier?: unknown
  closeDeadlineChoice?: unknown
  closeDeadlineDaysAfterEnd?: unknown
}

export function closeDeadlineDay(answers: ClosingDeadlineAnswers): CloseTier {
  const custom = Number(answers.closeDeadlineDaysAfterEnd)
  if (Number.isInteger(custom) && custom >= 1 && custom <= MAX_CLOSE_DAYS_AFTER_END) return custom as CloseTier
  const legacy = Number(answers.monthlyCloseTier)
  return legacy === 5 || legacy === 10 ? legacy : 15
}

export function closeDeadlineChoice(answers: ClosingDeadlineAnswers): '5' | '10' | '15' | 'other' | undefined {
  const choice = answers.closeDeadlineChoice
  if (choice === '5' || choice === '10' || choice === '15' || choice === 'other') return choice
  if (answers.closeDeadlineDaysAfterEnd != null) {
    const day = closeDeadlineDay(answers)
    return day === 5 ? '5' : day === 10 ? '10' : day === 15 ? '15' : 'other'
  }
  const tier = answers.monthlyCloseTier
  return tier === '5' || tier === '10' || tier === '15' ? tier : undefined
}
