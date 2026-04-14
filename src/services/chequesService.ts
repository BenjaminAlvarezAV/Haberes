import axios from 'axios'
import type { ChequesBundle } from '../types/cheques'
import {
  normalizeLiquidPorEstablecimiento,
  normalizeLiquidacionPorSecuencia,
  normalizeMensajeria,
} from '../utils/normalizeChequesResponse'
import { mapLimit } from '../utils/promise'
import type { LiquidacionPorSecuenciaItem } from '../types/cheques'

const chequesClient = axios.create({
  // En dev usamos el proxy de Vite; en prod se puede setear por env.
  baseURL: (import.meta.env.VITE_CHEQUES_BASE_URL as string | undefined) ?? '',
  timeout: 30_000,
})

function logDevRequest(endpoint: string, id: string, periodoYYYYMM: string): void {
  if (!import.meta.env.DEV) return
  console.info('[chequesService] request', { endpoint, id, periodoYYYYMM })
}

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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetries<T>(
  task: () => Promise<T>,
  label: string,
  errors: string[],
  attempts: number = 3,
  baseDelayMs: number = 400,
): Promise<T | null> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task()
    } catch (e) {
      lastError = e
      if (attempt < attempts) {
        const delay = baseDelayMs * attempt
        await sleep(delay)
      }
    }
  }

  errors.push(`${label}: ${friendlyErrorLabel(lastError)}`)
  return null
}

export async function fetchChequesBundle(id: string, periodoYYYYMM: string): Promise<ChequesBundle> {
  const errors: string[] = []
  logDevRequest('liquidPorEstablecimiento', id, periodoYYYYMM)
  logDevRequest('liquidacionPorSecuencia', id, periodoYYYYMM)
  logDevRequest('mensajeria', id, periodoYYYYMM)

  const [estab, secu, msg] = await Promise.all([
    fetchWithRetries(
      () =>
        chequesClient
          .get<unknown>(`/wsstestsigue/cheques/liquidPorEstablecimiento/${id}/${periodoYYYYMM}`)
          .then((r) => normalizeLiquidPorEstablecimiento(r.data)),
      'liquidPorEstablecimiento',
      errors,
    ).then((res) => res ?? []),
    fetchWithRetries(
      () =>
        chequesClient
          .get<unknown>(`/wsstestsigue/cheques/liquidacionPorSecuencia/${id}/${periodoYYYYMM}`)
          .then((r) => normalizeLiquidacionPorSecuencia(r.data)),
      'liquidacionPorSecuencia',
      errors,
    ).then((res) => res ?? []),
    fetchWithRetries(
      () =>
        chequesClient
          .get<unknown>(`/wsstestsigue/cheques/mensajeria/${id}/${periodoYYYYMM}`)
          .then((r) => normalizeMensajeria(r.data)),
      'mensajeria',
      errors,
    ).then(
      (res) =>
        res ?? {
          mensajeGeneral: [],
          mensajesPersonalizados: [],
        },
    ),
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

export async function fetchLiquidacionPorSecuencia(
  id: string,
  periodoYYYYMM: string,
): Promise<{ rows: LiquidacionPorSecuenciaItem[]; errors: string[] }> {
  const errors: string[] = []
  logDevRequest('liquidacionPorSecuencia', id, periodoYYYYMM)
  const rows =
    (await fetchWithRetries(
      () =>
        chequesClient
          .get<unknown>(`/wsstestsigue/cheques/liquidacionPorSecuencia/${id}/${periodoYYYYMM}`)
          .then((r) => normalizeLiquidacionPorSecuencia(r.data)),
      'liquidacionPorSecuencia',
      errors,
    )) ?? []

  return { rows, errors }
}

export function extractCuilFromLiquidacion(rows: LiquidacionPorSecuenciaItem[]): string | null {
  for (const r of rows) {
    if (r.cuitCuil && typeof r.cuitCuil === 'string' && r.cuitCuil.trim()) return r.cuitCuil
  }
  return null
}

export type ChequesBundleMap = Record<string, ChequesBundle>

export async function fetchChequesForPairs(
  pairs: Array<{ id: string; periodoYYYYMM: string }>,
  opts?: { concurrency?: number; onProgress?: (current: number, total: number) => void },
): Promise<ChequesBundleMap> {
  // Aumentamos levemente la concurrencia por defecto para grandes volúmenes.
  const concurrency = opts?.concurrency ?? 10
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

