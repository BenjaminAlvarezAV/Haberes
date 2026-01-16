import { describe, expect, it } from 'vitest'
import type { NormalizedPayroll } from '../types/payroll'
import { groupByAgent, groupByPeriod } from './grouping'

const normalized: NormalizedPayroll = {
  agents: [{ cuil: '20304050607' }, { cuil: '27111111119' }],
  items: [
    { cuil: '20304050607', periodo: '2025-01', concepto: 'A', importe: 1 },
    { cuil: '20304050607', periodo: '2025-02', concepto: 'B', importe: 2 },
    { cuil: '27111111119', periodo: '2025-01', concepto: 'C', importe: 3 },
  ],
}

describe('grouping', () => {
  it('groupByAgent agrupa por cuil', () => {
    const { byCuil, orderedCuils } = groupByAgent(normalized)
    expect(orderedCuils).toEqual(['20304050607', '27111111119'])
    expect(byCuil['20304050607']).toHaveLength(2)
    expect(byCuil['27111111119']).toHaveLength(1)
  })

  it('groupByPeriod agrupa por periodo', () => {
    const { byPeriod, orderedPeriods } = groupByPeriod(normalized)
    expect(orderedPeriods).toEqual(['2025-01', '2025-02'])
    expect(byPeriod['2025-01']).toHaveLength(2)
    expect(byPeriod['2025-02']).toHaveLength(1)
  })
})
