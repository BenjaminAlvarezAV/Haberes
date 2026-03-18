import { isLikelyCuil, normalizeCuil } from './cuil'
import { currentYYYYMM, isFutureYYYYMM, isValidYYYYMM } from './period'

export interface ParseCuilOptions {
  minLength?: number
}

export interface ParseCuilReport {
  totalLines: number
  valid: number
  invalid: number
  duplicates: number
  parseMs?: number
  rowsPerSec?: number
}

export interface ParseCuilResult {
  cuils: string[]
  report: ParseCuilReport
  invalidLines: string[]
  duplicateCuils: string[]
}

export interface ParseSercopeRow {
  documento: string
  periodoDesde: string // YYYYMM
  periodoHasta: string // YYYYMM
  secuencia: string // 000
}

export interface ParseSercopeCsvResult {
  rows: ParseSercopeRow[]
  documentos: string[]
  report: ParseCuilReport
  invalidLines: string[]
  duplicateRows: string[]
}

export interface ParseProgress {
  percent: number
  rows: number
}

export interface ParseSercopeCsvOptions {
  onProgress?: (progress: ParseProgress) => void
}

export function parseCuilTextDetailed(
  text: string,
  options: ParseCuilOptions = {},
): ParseCuilResult {
  const startMs = Date.now()
  const minLength = options.minLength ?? 11

  const lines = text.split(/\r?\n/)
  const seen = new Set<string>()
  const duplicateCuils: string[] = []
  const invalidLines: string[] = []
  const cuils: string[] = []

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    const cuil = normalizeCuil(trimmed)
    if (!isLikelyCuil(cuil, minLength)) {
      invalidLines.push(trimmed)
      continue
    }

    if (seen.has(cuil)) {
      duplicateCuils.push(cuil)
      continue
    }

    seen.add(cuil)
    cuils.push(cuil)
  }

  const parseMs = Date.now() - startMs
  return {
    cuils,
    invalidLines,
    duplicateCuils,
    report: {
      totalLines: lines.length,
      valid: cuils.length,
      invalid: invalidLines.length,
      duplicates: duplicateCuils.length,
      parseMs,
      rowsPerSec: lines.length > 0 ? Math.round((lines.length / Math.max(1, parseMs)) * 1000) : 0,
    },
  }
}

function normalizeDigits(value: string): string {
  return value.replace(/[^\d]/g, '')
}

function splitCsvLine(line: string): string[] {
  // Simple y tolerante: coma o punto y coma; quita comillas exteriores.
  const sep = line.includes(';') && !line.includes(',') ? ';' : ','
  return line
    .split(sep)
    .map((s) => s.trim())
    .map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).trim() : s))
}

export function parseSercopeCsvTextDetailed(
  text: string,
  maxYYYYMM: string = currentYYYYMM(),
): ParseSercopeCsvResult {
  const startMs = Date.now()
  const lines = text.split(/\r?\n/)
  const seenRows = new Set<string>()
  const seenDocs = new Set<string>()

  const invalidLines: string[] = []
  const duplicateRows: string[] = []
  const rows: ParseSercopeRow[] = []
  const documentos: string[] = []

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    // Header típico: Documento,PeriodoDesde,PeriodoHasta,Secuencia
    const lower = trimmed.toLowerCase()
    if (lower.includes('documento') && lower.includes('periodo')) continue

    const parts = splitCsvLine(trimmed)
    if (parts.length < 4) {
      invalidLines.push(trimmed)
      continue
    }

    const documento = normalizeDigits(parts[0])
    const periodoDesde = normalizeDigits(parts[1])
    const periodoHasta = normalizeDigits(parts[2])
    const secuencia = normalizeDigits(parts[3]).padStart(3, '0')

    // Permitimos DNI (8) o CUIL (11). La lógica de consulta/validación se aplica más adelante.
    if (!/^\d{8}$/.test(documento) && !/^\d{11}$/.test(documento)) {
      invalidLines.push(trimmed)
      continue
    }
    if (!isValidYYYYMM(periodoDesde) || !isValidYYYYMM(periodoHasta)) {
      invalidLines.push(trimmed)
      continue
    }
    if (!/^\d{3}$/.test(secuencia)) {
      invalidLines.push(trimmed)
      continue
    }

    if (periodoDesde > periodoHasta) {
      invalidLines.push(trimmed)
      continue
    }
    if (isFutureYYYYMM(periodoHasta, maxYYYYMM)) {
      invalidLines.push(trimmed)
      continue
    }

    const key = `${documento}-${periodoDesde}-${periodoHasta}-${secuencia}`
    if (seenRows.has(key)) {
      duplicateRows.push(key)
      continue
    }

    seenRows.add(key)
    rows.push({ documento, periodoDesde, periodoHasta, secuencia })

    if (!seenDocs.has(documento)) {
      seenDocs.add(documento)
      documentos.push(documento)
    }
  }

  const parseMs = Date.now() - startMs
  return {
    rows,
    documentos,
    invalidLines,
    duplicateRows,
    report: {
      totalLines: lines.length,
      valid: rows.length,
      invalid: invalidLines.length,
      duplicates: duplicateRows.length,
      parseMs,
      rowsPerSec: lines.length > 0 ? Math.round((lines.length / Math.max(1, parseMs)) * 1000) : 0,
    },
  }
}

async function readFileAsText(file: File): Promise<string> {
  // `File.text()` no está disponible en todos los entornos (p.ej. jsdom de tests).
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Error al leer el archivo'))
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsText(file)
  })
}

export async function parseCuilTxt(file: File, options: ParseCuilOptions = {}): Promise<string[]> {
  const text = await readFileAsText(file)
  return parseCuilTextDetailed(text, options).cuils
}

export async function parseCuilTxtDetailed(
  file: File,
  options: ParseCuilOptions = {},
): Promise<ParseCuilResult> {
  const text = await readFileAsText(file)
  return parseCuilTextDetailed(text, options)
}

export async function parseSercopeCsvDetailed(
  file: File,
  options: ParseSercopeCsvOptions = {},
): Promise<ParseSercopeCsvResult> {
  if (typeof Worker === 'undefined') {
    options.onProgress?.({ percent: 0, rows: 0 })
    const text = await readFileAsText(file)
    const result = parseSercopeCsvTextDetailed(text)
    options.onProgress?.({ percent: 100, rows: result.report.totalLines })
    return result
  }

  const { parseSercopeCsvInWorker } = await import('./workerClient')
  return parseSercopeCsvInWorker(file, options)
}
