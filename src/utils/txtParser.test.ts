import { describe, expect, it } from 'vitest'
import { parseCuilTxt, parseCuilTextDetailed } from './txtParser'

describe('parseCuilTxt', () => {
  it('normaliza, tolera guiones/espacios y deduplica', async () => {
    const content = `20-30405060-7
20304050607
  27 11111111 9
20304050607
invalido
`

    const file = new File([content], 'cuils.txt', { type: 'text/plain' })
    const cuils = await parseCuilTxt(file)

    expect(cuils).toEqual(['20304050607', '27111111119'])
  })

  it('reporte cuenta invalidos y duplicados', () => {
    const content = `20304050607
20304050607
abc
`
    const detailed = parseCuilTextDetailed(content)
    expect(detailed.report.valid).toBe(1)
    expect(detailed.report.duplicates).toBe(1)
    expect(detailed.report.invalid).toBe(1)
  })
})
