import axios from 'axios'
import type { ChequesBundle } from '../types/cheques'
import {
  normalizeLiquidPorEstablecimiento,
  normalizeLiquidacionPorSecuencia,
  normalizeMensajeria,
} from '../utils/normalizeChequesResponse'
import { mapLimit } from '../utils/promise'

const chequesClient = axios.create({
  // baseURL vacío => mismo origen; en dev se resuelve con proxy Vite.
  baseURL: '',
  timeout: 30_000,
})

function keyFor(id: string, periodoYYYYMM: string): string {
  return `${id}-${periodoYYYYMM}`
}

export async function fetchChequesBundle(id: string, periodoYYYYMM: string): Promise<ChequesBundle> {
  const errors: string[] = []

  const [estab, secu, msg] = await Promise.all([
    chequesClient
      .get<unknown>(`/wsstestsigue/cheques/liquidPorEstablecimiento/${id}/${periodoYYYYMM}`)
      .then((r) => normalizeLiquidPorEstablecimiento(r.data))
      .catch((e: unknown) => {
        errors.push(e instanceof Error ? e.message : 'Error liquidPorEstablecimiento')
        return []
      }),
    chequesClient
      .get<unknown>(`/wsstestsigue/cheques/liquidacionPorSecuencia/${id}/${periodoYYYYMM}`)
      .then((r) => normalizeLiquidacionPorSecuencia(r.data))
      .catch((e: unknown) => {
        errors.push(e instanceof Error ? e.message : 'Error liquidacionPorSecuencia')
        return []
      }),
    chequesClient
      .get<unknown>(`/wsstestsigue/cheques/mensajeria/${id}/${periodoYYYYMM}`)
      .then((r) => normalizeMensajeria(r.data))
      .catch((e: unknown) => {
        errors.push(e instanceof Error ? e.message : 'Error mensajeria')
        return { mensajeGeneral: [], mensajesPersonalizados: [] }
      }),
  ])

  return {
    id,
    periodoYYYYMM,
    liquidPorEstablecimiento: estab,
    liquidacionPorSecuencia: secu,
    mensajeria: msg,
    ...(errors.length ? { errors } : {}),
  }
}

export type ChequesBundleMap = Record<string, ChequesBundle>

export async function fetchChequesForPairs(
  pairs: Array<{ id: string; periodoYYYYMM: string }>,
  opts?: { concurrency?: number },
): Promise<ChequesBundleMap> {
  const concurrency = opts?.concurrency ?? 6
  const map: ChequesBundleMap = {}

  await mapLimit(pairs, concurrency, async (p) => {
    const bundle = await fetchChequesBundle(p.id, p.periodoYYYYMM)
    map[keyFor(p.id, p.periodoYYYYMM)] = bundle
    return null
  })

  return map
}

export function chequesKey(id: string, periodoYYYYMM: string): string {
  return keyFor(id, periodoYYYYMM)
}

