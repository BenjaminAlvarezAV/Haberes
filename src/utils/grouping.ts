import type { NormalizedPayroll, PayrollItem } from '../types/payroll'

export interface GroupedByAgent {
  byCuil: Record<string, PayrollItem[]>
  orderedCuils: string[]
}

export interface GroupedByPeriod {
  byPeriod: Record<string, PayrollItem[]>
  orderedPeriods: string[]
}

export function groupByAgent(normalized: NormalizedPayroll): GroupedByAgent {
  const byCuil: Record<string, PayrollItem[]> = {}

  for (const item of normalized.items) {
    ;(byCuil[item.cuil] ??= []).push(item)
  }

  const orderedCuils = Object.keys(byCuil).sort()
  for (const cuil of orderedCuils) {
    byCuil[cuil].sort((a, b) => a.periodo.localeCompare(b.periodo))
  }

  return { byCuil, orderedCuils }
}

export function groupByPeriod(normalized: NormalizedPayroll): GroupedByPeriod {
  const byPeriod: Record<string, PayrollItem[]> = {}

  for (const item of normalized.items) {
    ;(byPeriod[item.periodo] ??= []).push(item)
  }

  const orderedPeriods = Object.keys(byPeriod).sort()
  for (const period of orderedPeriods) {
    byPeriod[period].sort((a, b) => a.cuil.localeCompare(b.cuil))
  }

  return { byPeriod, orderedPeriods }
}
