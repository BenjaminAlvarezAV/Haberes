import { describe, expect, it } from 'vitest'
import { parseSercopeCsvTextDetailed } from './txtParser'

describe('parseSercopeCsvTextDetailed', () => {
  it('parsea CSV con header, normaliza dígitos y deduplica filas por key completa', () => {
    const csv = `Documento,PeriodoDesde,PeriodoHasta,Secuencia
"12.345.678",202401,202402,1
12345678;202401;202402;001
12345678,202401,202402,001
`

    const res = parseSercopeCsvTextDetailed(csv, '202412')

    // La fila con documento/desde/hasta/secuencia idénticos se considera duplicada.
    expect(res.report.valid).toBe(1)
    expect(res.report.duplicates).toBe(2)
    expect(res.documentos).toEqual(['12345678'])
    expect(res.rows[0]).toEqual({
      documento: '12345678',
      periodoDesde: '202401',
      periodoHasta: '202402',
      secuencia: '001',
    })
  })

  it('acepta CUIL (11) en Documento', () => {
    const csv = `Documento,PeriodoDesde,PeriodoHasta,Secuencia
20-12345678-3,202401,202401,1
`

    const res = parseSercopeCsvTextDetailed(csv, '202412')
    expect(res.report.valid).toBe(1)
    expect(res.documentos).toEqual(['20123456783'])
    expect(res.rows[0]?.documento).toBe('20123456783')
  })

  it('acepta DNI alfanumérico en Documento', () => {
    const csv = `Documento,PeriodoDesde,PeriodoHasta,Secuencia
f1234567,202401,202401,1
`

    const res = parseSercopeCsvTextDetailed(csv, '202412')
    expect(res.report.valid).toBe(1)
    expect(res.documentos).toEqual(['F1234567'])
    expect(res.rows[0]?.documento).toBe('F1234567')
  })

  it('rechaza rangos inválidos y períodos futuros', () => {
    const csv = `12345678,202501,202412,001
12345678,202401,202501,001
`

    const res = parseSercopeCsvTextDetailed(csv, '202412')
    expect(res.report.valid).toBe(0)
    expect(res.report.invalid).toBeGreaterThan(0)
  })
})


