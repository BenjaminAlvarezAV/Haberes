import axios from 'axios'
import type { ChequesBundle } from '../types/cheques'
import {
  normalizeLiquidPorEstablecimiento,
  normalizeLiquidacionPorSecuencia,
  normalizeMensajeria,
} from '../utils/normalizeChequesResponse'
import { mapLimit } from '../utils/promise'

const chequesClient = axios.create({
  // En dev usamos el proxy de Vite; en prod se puede setear por env.
  baseURL: (import.meta.env.VITE_CHEQUES_BASE_URL as string | undefined) ?? '',
  timeout: 30_000,
})

function keyFor(id: string, periodoYYYYMM: string): string {
  return `${id}-${periodoYYYYMM}`
}

function friendlyErrorLabel(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const status = e.response?.status
    if (status === 403) return 'Forbidden (posible VPN requerida)'
    if (status) return `HTTP ${status}`
  }
  return e instanceof Error ? e.message : 'Error'
}

export async function fetchChequesBundle(id: string, periodoYYYYMM: string): Promise<ChequesBundle> {
  const errors: string[] = []

  const [estab, secu, msg] = await Promise.all([
    chequesClient
      .get<unknown>(`/wsstestsigue/cheques/liquidPorEstablecimiento/${id}/${periodoYYYYMM}`)
      .then((r) => normalizeLiquidPorEstablecimiento(r.data))
      .catch((e: unknown) => {
        errors.push(`liquidPorEstablecimiento: ${friendlyErrorLabel(e)}`)
        return []
      }),
    chequesClient
      .get<unknown>(`/wsstestsigue/cheques/liquidacionPorSecuencia/${id}/${periodoYYYYMM}`)
      .then((r) => normalizeLiquidacionPorSecuencia(r.data))
      .catch((e: unknown) => {
        errors.push(`liquidacionPorSecuencia: ${friendlyErrorLabel(e)}`)
        return []
      }),
    chequesClient
      .get<unknown>(`/wsstestsigue/cheques/mensajeria/${id}/${periodoYYYYMM}`)
      .then((r) => normalizeMensajeria(r.data))
      .catch((e: unknown) => {
        errors.push(`mensajeria: ${friendlyErrorLabel(e)}`)
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
  opts?: { concurrency?: number; onProgress?: (current: number, total: number) => void },
): Promise<ChequesBundleMap> {
  const concurrency = opts?.concurrency ?? 6
  const map: ChequesBundleMap = {}
  let completed = 0
  const total = pairs.length

  if (total === 0) {
    opts?.onProgress?.(0, 0)
  }

  await mapLimit(pairs, concurrency, async (p) => {
    const bundle = await fetchChequesBundle(p.id, p.periodoYYYYMM)
    map[keyFor(p.id, p.periodoYYYYMM)] = bundle
    completed += 1
    opts?.onProgress?.(completed, total)
    return null
  })

  return map
}

export function chequesKey(id: string, periodoYYYYMM: string): string {
  return keyFor(id, periodoYYYYMM)
}

