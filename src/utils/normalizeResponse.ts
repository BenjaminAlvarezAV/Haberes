import { z } from 'zod'
import type { Agent, NormalizedPayroll, PayrollItem } from '../types/payroll'
import { normalizeCuil } from './cuil'
import { isValidPeriod } from './period'

function toString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const normalized = value.replace(/\./g, '').replace(',', '.').trim()
    const n = Number(normalized)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const rawItemSchema = z.object({}).catchall(z.unknown())

function pickFirst<T>(
  obj: Record<string, unknown>,
  keys: readonly string[],
  map: (v: unknown) => T | null,
): T | null {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const mapped = map(obj[k])
      if (mapped !== null) return mapped
    }
  }
  return null
}

function extractRawItems(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    const candidates = ['items', 'records', 'data', 'result', 'liquidaciones', 'haberes'] as const
    for (const key of candidates) {
      const v = r[key]
      if (Array.isArray(v)) return v
    }
  }
  return null
}

export function normalizeResponse(raw: unknown): NormalizedPayroll {
  const rawItems = extractRawItems(raw)
  if (!rawItems) {
    return {
      items: [],
      agents: [],
      errors: [
        { cuil: '', message: 'Respuesta sin items: no se encontró un array en keys esperadas' },
      ],
    }
  }

  const items: PayrollItem[] = []
  const errors: { cuil: string; message: string }[] = []

  for (const entry of rawItems) {
    const parsed = rawItemSchema.safeParse(entry)
    if (!parsed.success) {
      errors.push({ cuil: '', message: 'Item inválido (no es objeto)' })
      continue
    }

    const obj = parsed.data

    const rawCuil =
      pickFirst(obj, ['cuil', 'CUIL', 'cuilAgente', 'agenteCuil', 'documento'], toString) ?? ''
    const cuil = normalizeCuil(rawCuil)

    const periodo =
      pickFirst(obj, ['periodo', 'period', 'mes', 'periodoLiquidacion'], toString) ?? ''

    const concepto =
      pickFirst(
        obj,
        ['concepto', 'detalle', 'descripcion', 'conceptoDescripcion', 'desc'],
        toString,
      ) ?? 'Sin concepto'

    const importe =
      pickFirst(obj, ['importe', 'monto', 'importeNeto', 'neto', 'importeTotal'], toNumber) ?? null

    if (!cuil) {
      errors.push({ cuil: '', message: 'Item sin CUIL' })
      continue
    }
    if (!isValidPeriod(periodo)) {
      errors.push({ cuil, message: `Período inválido: "${periodo}"` })
      continue
    }
    if (importe === null) {
      errors.push({ cuil, message: 'Importe inválido o faltante' })
      continue
    }

    const tipo = pickFirst(obj, ['tipo', 'clase', 'signo'], toString) ?? undefined
    items.push({ cuil, periodo, concepto, importe, tipo })
  }

  const agentsFromRaw: Agent[] = []
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    const agents = r['agents']
    if (Array.isArray(agents)) {
      const agentSchema = z.object({ cuil: z.string(), nombre: z.string().optional() })
      for (const a of agents) {
        const pa = agentSchema.safeParse(a)
        if (pa.success)
          agentsFromRaw.push({ cuil: normalizeCuil(pa.data.cuil), nombre: pa.data.nombre })
      }
    }
  }

  const agents =
    agentsFromRaw.length > 0
      ? agentsFromRaw
      : Array.from(new Set(items.map((i) => i.cuil)))
          .sort()
          .map((cuil) => ({ cuil }))

  return {
    items,
    agents,
    ...(errors.length > 0 ? { errors } : {}),
  }
}
