import { describe, expect, it } from 'vitest'
import { expandYYYYMMRange } from './period'

describe('expandYYYYMMRange', () => {
  it('expande un rango inclusivo YYYYMM y lo devuelve como YYYY-MM', () => {
    expect(expandYYYYMMRange('202401', '202403')).toEqual(['2024-01', '2024-02', '2024-03'])
  })

  it('devuelve [] si el rango es inválido', () => {
    expect(expandYYYYMMRange('202413', '202501')).toEqual([])
    expect(expandYYYYMMRange('202402', '202401')).toEqual([])
  })
})


