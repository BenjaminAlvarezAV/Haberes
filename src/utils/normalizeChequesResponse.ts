import { z } from 'zod'
import type {
  LiquidPorEstablecimientoItem,
  LiquidacionPorSecuenciaItem,
  MensajeriaMessages,
} from '../types/cheques'

const objSchema = z.object({}).catchall(z.unknown())

function toString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const raw = value.trim()
    // Soportar ambos formatos:
    // - "1234.56" (decimal con punto)
    // - "1.234,56" (miles con punto, decimal con coma)
    // - "1234,56" (decimal con coma)
    let normalized = raw
    if (raw.includes(',') && raw.includes('.')) {
      normalized = raw.replace(/\./g, '').replace(',', '.')
    } else if (raw.includes(',')) {
      normalized = raw.replace(',', '.')
    }
    const n = Number(normalized)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function pickFirst<T>(
  obj: Record<string, unknown>,
  keys: readonly string[],
  map: (v: unknown) => T | null,
): T | null {
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue
    const mapped = map(obj[k])
    if (mapped !== null) return mapped
  }
  return null
}

function extractLiquidArray(raw: unknown): unknown[] {
  const parsed = objSchema.safeParse(raw)
  if (!parsed.success) return []
  const liquid = (parsed.data as Record<string, unknown>)['liquid']
  return Array.isArray(liquid) ? liquid : []
}

export function normalizeLiquidPorEstablecimiento(raw: unknown): LiquidPorEstablecimientoItem[] {
  const arr = extractLiquidArray(raw)
  const out: LiquidPorEstablecimientoItem[] = []
  for (const entry of arr) {
    const parsed = objSchema.safeParse(entry)
    if (!parsed.success) continue
    const o = parsed.data
    out.push({
      distrito: pickFirst(o, ['distrito'], (v) => (typeof v === 'number' ? v : toNumber(v))),
      tipoOrg: pickFirst(o, ['tipoOrg', 'tipoOrgInt'], toString),
      numero: pickFirst(o, ['numero', 'numeroInt'], (v) => toString(v)),
      nombreEstab: pickFirst(o, ['nombreEstab', 'nombreEstabInt', 'nomEstab'], toString),
      secu: pickFirst(o, ['secu'], (v) => toString(v)),
      perOpago: pickFirst(o, ['perOpago', 'periodoPago'], toString),
      nombreOpago: pickFirst(o, ['nombreOpago', 'nombrePago'], toString),
      liquido: pickFirst(o, ['liquido', 'liquidoNeto'], toNumber),
      fecPago: pickFirst(o, ['fecPago', 'fPago', 'fechaPago'], toString),
      opid: pickFirst(o, ['opid', 'opid'], (v) => toString(v)),
    })
  }
  return out
}

export function normalizeLiquidacionPorSecuencia(raw: unknown): LiquidacionPorSecuenciaItem[] {
  const arr = extractLiquidArray(raw)
  const out: LiquidacionPorSecuenciaItem[] = []
  for (const entry of arr) {
    const parsed = objSchema.safeParse(entry)
    if (!parsed.success) continue
    const o = parsed.data
    out.push({
      apYNom: pickFirst(o, ['apYNom', 'apyNom', 'apynom', 'apellidoNombre'], toString),
      numDoc: pickFirst(o, ['numDoc', 'documento', 'nroDoc'], toString),
      sexo: pickFirst(o, ['sexo'], toString),
      cuitCuil: pickFirst(o, ['cuitCuil', 'cuit', 'cuil'], toString),
      mesaPago: pickFirst(o, ['mesaPago', 'mesPago'], toString),
      tipoOrg: pickFirst(o, ['tipoOrg', 'tipoOrgInt'], toString),
      numero: pickFirst(o, ['numero', 'numeroInt'], toString),
      nombreEstab: pickFirst(o, ['nombreEstab', 'nombreEstabInt', 'nomEstab'], toString),
      tipoOrgInt: pickFirst(o, ['tipoOrgInt'], toString),
      numeroInt: pickFirst(o, ['numeroInt'], toString),
      nombreEstabInt: pickFirst(o, ['nombreEstabInt'], toString),
      secu: pickFirst(o, ['secu'], toString),
      rev: pickFirst(o, ['rev'], toString),
      estabPag: pickFirst(o, ['estabPag', 'estabPago', 'codEstab'], toString),
      distritoInt: pickFirst(o, ['distritoInt', 'distrito'], toString),
      ccticas: pickFirst(o, ['ccticas', 'ccticasInt'], toString),
      ccticasInt: pickFirst(o, ['ccticasInt'], toString),
      nomDistInt: pickFirst(o, ['nomDistInt', 'distritoNombre'], toString),
      cat: pickFirst(o, ['cat', 'catInt'], toString),
      catInt: pickFirst(o, ['catInt'], toString),
      rural: pickFirst(o, ['rural', 'ruralInt'], toString),
      ruralInt: pickFirst(o, ['ruralInt'], toString),
      secciones: pickFirst(o, ['secciones', 'seccionesInt'], toString),
      seccionesInt: pickFirst(o, ['seccionesInt'], toString),
      turnos: pickFirst(o, ['turnos', 'turnosInt'], toString),
      turnosInt: pickFirst(o, ['turnosInt'], toString),
      dobEscolEstab: pickFirst(o, ['dobEscolEstab', 'dobEscol', 'dobEscolInt'], toString),
      esCarcel: pickFirst(o, ['esCarcel', 'esDeno', 'carcel', 'establecimientoCarcelario'], toString),
      esDeno: pickFirst(o, ['esDeno', 'esdeno', 'isdeno'], toString),
      direccion: pickFirst(
        o,
        ['direccion', 'direccionEstab', 'dirEstab', 'direccionEstablecimiento', 'direccionEstabInt'],
        toString,
      ),
      cargoReal: pickFirst(o, ['cargoReal', 'cargo', 'cargoRealDesc', 'cargoRealNombre'], toString),
      choraria: pickFirst(o, ['hs', 'choraria', 'cHoraria', 'cargaHoraria', 'horaria'], toString),
      apoyoReal: pickFirst(o, ['apoyoReal', 'apoyo', 'apoyoRealDesc'], toString),
      cargoInt: pickFirst(o, ['cargoInt', 'cargoInterino', 'cargoInter'], toString),
      apoyoInt: pickFirst(o, ['apoyoInt', 'apoyoInterino', 'apoyoInter'], toString),
      antig: pickFirst(o, ['antig', 'antiguedad'], toString),
      inas: pickFirst(o, ['inas', 'inasistencias'], toString),
      codigo: pickFirst(o, ['codigo', 'cod'], toString),
      descripcionCodigo: pickFirst(o, ['descripcionCodigo', 'desc', 'descripcion'], toString),
      pesos: pickFirst(o, ['pesos', 'importe', 'monto'], toNumber),
      oPid: pickFirst(o, ['oPid', 'opid'], toString),
      fecAfec: pickFirst(o, ['fecAfec', 'perOpago', 'periodo'], toString),
    })
  }
  return out
}

export function normalizeMensajeria(raw: unknown): MensajeriaMessages {
  const parsed = objSchema.safeParse(raw)
  if (!parsed.success) return { mensajeGeneral: [], mensajesPersonalizados: [] }
  const r = parsed.data as Record<string, unknown>
  const container =
    // Algunos servicios envuelven la mensajería dentro de una clave "mensajeria".
    (r['mensajeria'] as unknown) ??
    (r['data'] as unknown) ??
    (r['result'] as unknown) ??
    (r['resultado'] as unknown) ??
    raw
  const p2 = objSchema.safeParse(container)
  const c = p2.success ? (p2.data as Record<string, unknown>) : r

  const mg =
    c['mensajeGeneral'] ??
    c['MensajeGeneral'] ??
    c['mensajesGenerales'] ??
    c['MensajesGenerales'] ??
    c['general'] ??
    c['General'] ??
    []
  const mp =
    c['mensajesPersonalizados'] ??
    c['MensajesPersonalizados'] ??
    c['personalizados'] ??
    c['Personalizados'] ??
    []

  const toList = (v: unknown): string[] => {
    if (!Array.isArray(v)) return []
    const out: string[] = []
    for (const e of v) {
      const s = toString(e)
      if (s) out.push(s)
      else {
        const eo = objSchema.safeParse(e)
        if (eo.success) {
          const msg =
            pickFirst(eo.data, ['mensaje', 'texto', 'descripcion', 'detalle', 'valor'], toString) ?? null
          if (msg) out.push(msg)
        }
      }
    }
    return out
  }

  return { mensajeGeneral: toList(mg), mensajesPersonalizados: toList(mp) }
}

