import type { ChequesBundle } from '../types/cheques'
import { expandYYYYMMRange, yyyymmToPeriod } from './period'
import type { ParseSercopeRow } from './txtParser'

/** CSV: 000 = todas las secuencias; otro valor (3 dígitos) = esa secuencia. */
export function csvSecuenciaToFilter(csvSecuencia: string): string | null {
  const s = csvSecuencia.replace(/\D/g, '').padStart(3, '0')
  if (!/^\d{3}$/.test(s)) return null
  if (s === '000') return null
  return s
}

export type SecuenciaFilterSpec =
  | { mode: 'all' }
  | { mode: 'only'; codes: Set<string> }

export function filterSpecFromCsvSecuencia(secuencia: string): SecuenciaFilterSpec {
  const code = csvSecuenciaToFilter(secuencia)
  if (code === null) return { mode: 'all' }
  return { mode: 'only', codes: new Set([code]) }
}

export function mergeSecuenciaFilterSpecs(a: SecuenciaFilterSpec, b: SecuenciaFilterSpec): SecuenciaFilterSpec {
  if (a.mode === 'all' || b.mode === 'all') return { mode: 'all' }
  return { mode: 'only', codes: new Set([...a.codes, ...b.codes]) }
}

export function secuValueMatchesFilter(
  apiSecu: string | number | null | undefined,
  filter3: string,
): boolean {
  const raw = String(apiSecu ?? '').trim()
  if (raw === '') return false
  const d = raw.replace(/\D/g, '')
  if (!d) return false
  const api3 = d.length <= 3 ? d.padStart(3, '0') : d.slice(-3)
  return api3 === filter3
}

function rowMatchesSecuenciaSpec(
  r: { secu: string | number | null | undefined },
  spec: SecuenciaFilterSpec,
): boolean {
  if (spec.mode === 'all') return true
  for (const c of spec.codes) {
    if (secuValueMatchesFilter(r.secu, c)) return true
  }
  return false
}

export function filterChequesBundleBySecuencia(
  bundle: ChequesBundle,
  spec: SecuenciaFilterSpec,
): ChequesBundle {
  if (spec.mode === 'all') return bundle
  if (spec.codes.size === 0) return bundle
  return {
    ...bundle,
    liquidacionPorSecuencia: bundle.liquidacionPorSecuencia.filter((r) =>
      rowMatchesSecuenciaSpec(r, spec),
    ),
    liquidPorEstablecimiento: bundle.liquidPorEstablecimiento.filter((r) =>
      rowMatchesSecuenciaSpec(r, spec),
    ),
  }
}

/** Une todas las filas del CSV que cubren este documento y período (varias líneas = varias secuencias). */
export function resolveCsvSecuenciaFilterSpecForPair(
  id: string,
  periodoYYYYMM: string,
  csvRows: ParseSercopeRow[],
  normalizeDoc: (raw: string) => string | null,
): SecuenciaFilterSpec {
  const periodo = yyyymmToPeriod(periodoYYYYMM)
  let acc: SecuenciaFilterSpec | null = null
  for (const row of csvRows) {
    const rid = normalizeDoc(row.documento)
    if (rid !== id) continue
    const range = expandYYYYMMRange(row.periodoDesde, row.periodoHasta)
    if (!range.includes(periodo)) continue
    const part = filterSpecFromCsvSecuencia(row.secuencia)
    acc = acc === null ? part : mergeSecuenciaFilterSpecs(acc, part)
  }
  return acc ?? { mode: 'all' }
}
