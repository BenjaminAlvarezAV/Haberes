import { describe, expect, it } from 'vitest'
import { payrollResponseFixture } from '../fixtures/payrollResponseFixture'
import { normalizeResponse } from './normalizeResponse'

describe('normalizeResponse', () => {
  it('mapea y normaliza a modelo interno estable', () => {
    const normalized = normalizeResponse(payrollResponseFixture)
    expect(normalized.items.length).toBe(3)
    expect(normalized.items[0]).toMatchObject({
      cuil: '20304050607',
      periodo: '2025-01',
    })
    expect(normalized.agents.length).toBeGreaterThan(0)
  })
})
