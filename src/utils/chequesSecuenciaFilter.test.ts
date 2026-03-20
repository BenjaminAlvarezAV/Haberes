import { describe, expect, it } from 'vitest'
import {
  csvSecuenciaToFilter,
  filterChequesBundleBySecuencia,
  filterSpecFromCsvSecuencia,
  mergeSecuenciaFilterSpecs,
  resolveCsvSecuenciaFilterSpecForPair,
  secuValueMatchesFilter,
} from './chequesSecuenciaFilter'
import type { ChequesBundle } from '../types/cheques'

describe('csvSecuenciaToFilter', () => {
  it('000 implica sin filtro', () => {
    expect(csvSecuenciaToFilter('000')).toBeNull()
  })

  it('otros códigos se normalizan a 3 dígitos', () => {
    expect(csvSecuenciaToFilter('1')).toBe('001')
    expect(csvSecuenciaToFilter('12')).toBe('012')
    expect(csvSecuenciaToFilter('001')).toBe('001')
  })
})

describe('secuValueMatchesFilter', () => {
  it('compara tolerando distintos formatos', () => {
    expect(secuValueMatchesFilter('1', '001')).toBe(true)
    expect(secuValueMatchesFilter(2, '002')).toBe(true)
    expect(secuValueMatchesFilter('003', '003')).toBe(true)
    expect(secuValueMatchesFilter('004', '001')).toBe(false)
  })

  it('vacío no coincide cuando hay filtro', () => {
    expect(secuValueMatchesFilter('', '001')).toBe(false)
    expect(secuValueMatchesFilter(null, '001')).toBe(false)
  })
})

describe('mergeSecuenciaFilterSpecs', () => {
  it('000 (all) domina', () => {
    const a = filterSpecFromCsvSecuencia('001')
    const b = filterSpecFromCsvSecuencia('000')
    expect(mergeSecuenciaFilterSpecs(a, b)).toEqual({ mode: 'all' })
  })

  it('une varias secuencias concretas', () => {
    const a = filterSpecFromCsvSecuencia('001')
    const b = filterSpecFromCsvSecuencia('002')
    const m = mergeSecuenciaFilterSpecs(a, b)
    expect(m.mode).toBe('only')
    if (m.mode === 'only') expect([...m.codes].sort()).toEqual(['001', '002'])
  })
})

describe('resolveCsvSecuenciaFilterSpecForPair', () => {
  it('combina filas separadas que cubren el mismo mes', () => {
    const norm = (d: string) => d.replace(/\D/g, '').slice(-8) || null
    const rows = [
      { documento: '12345678', periodoDesde: '202401', periodoHasta: '202401', secuencia: '001' },
      { documento: '12345678', periodoDesde: '202401', periodoHasta: '202401', secuencia: '002' },
    ] as const
    const spec = resolveCsvSecuenciaFilterSpecForPair('12345678', '202401', [...rows], norm)
    expect(spec.mode).toBe('only')
    if (spec.mode === 'only') expect([...spec.codes].sort()).toEqual(['001', '002'])
  })
})

describe('filterChequesBundleBySecuencia', () => {
  it('sin filtro devuelve la misma referencia', () => {
    const b: ChequesBundle = {
      id: '1',
      periodoYYYYMM: '202401',
      liquidPorEstablecimiento: [],
      liquidacionPorSecuencia: [],
      mensajeria: { mensajeGeneral: [], mensajesPersonalizados: [] },
    }
    expect(filterChequesBundleBySecuencia(b, { mode: 'all' })).toBe(b)
  })

  it('filtra por una secuencia', () => {
    const b: ChequesBundle = {
      id: '1',
      periodoYYYYMM: '202401',
      liquidPorEstablecimiento: [
        {
          distrito: null,
          tipoOrg: null,
          numero: null,
          nombreEstab: null,
          secu: '1',
          perOpago: null,
          nombreOpago: null,
          liquido: 10,
          fecPago: null,
          opid: null,
        },
        {
          distrito: null,
          tipoOrg: null,
          numero: null,
          nombreEstab: null,
          secu: '2',
          perOpago: null,
          nombreOpago: null,
          liquido: 20,
          fecPago: null,
          opid: null,
        },
      ],
      liquidacionPorSecuencia: [
        { secu: '001', pesos: 1, codigo: 'a', descripcionCodigo: 'x' },
        { secu: '002', pesos: 2, codigo: 'b', descripcionCodigo: 'y' },
      ] as ChequesBundle['liquidacionPorSecuencia'],
      mensajeria: { mensajeGeneral: [], mensajesPersonalizados: [] },
    }
    const out = filterChequesBundleBySecuencia(b, { mode: 'only', codes: new Set(['001']) })
    expect(out.liquidPorEstablecimiento).toHaveLength(1)
    expect(out.liquidacionPorSecuencia).toHaveLength(1)
  })

  it('admite varias secuencias en el mismo bundle', () => {
    const b: ChequesBundle = {
      id: '1',
      periodoYYYYMM: '202401',
      liquidPorEstablecimiento: [],
      liquidacionPorSecuencia: [
        { secu: '001', pesos: 1, codigo: 'a', descripcionCodigo: 'x' },
        { secu: '002', pesos: 2, codigo: 'b', descripcionCodigo: 'y' },
        { secu: '003', pesos: 3, codigo: 'c', descripcionCodigo: 'z' },
      ] as ChequesBundle['liquidacionPorSecuencia'],
      mensajeria: { mensajeGeneral: [], mensajesPersonalizados: [] },
    }
    const out = filterChequesBundleBySecuencia(b, { mode: 'only', codes: new Set(['001', '002']) })
    expect(out.liquidacionPorSecuencia).toHaveLength(2)
  })
})
