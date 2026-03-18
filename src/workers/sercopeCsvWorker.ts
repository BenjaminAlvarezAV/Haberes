/// <reference lib="webworker" />
import Papa from 'papaparse'
import type { ParseSercopeCsvResult, ParseSercopeRow } from '../utils/txtParser'
import { isFutureYYYYMM, isValidYYYYMM } from '../utils/period'

type WorkerRequest = {
  file: File
  maxYYYYMM: string
}

type WorkerSuccess = {
  type: 'success'
  result: ParseSercopeCsvResult
}

type WorkerProgress = {
  type: 'progress'
  progress: {
    percent: number
    rows: number
  }
}

type WorkerError = {
  type: 'error'
  message: string
}

function normalizeDigits(value: string): string {
  return value.replace(/[^\d]/g, '')
}

function isHeaderRow(parts: string[]): boolean {
  const lower = parts.join(' ').toLowerCase()
  return lower.includes('documento') && lower.includes('periodo')
}

function normalizeRow(parts: string[], maxYYYYMM: string): ParseSercopeRow | null {
  if (parts.length < 4) return null
  const documento = normalizeDigits(parts[0] ?? '')
  const periodoDesde = normalizeDigits(parts[1] ?? '')
  const periodoHasta = normalizeDigits(parts[2] ?? '')
  const secuencia = normalizeDigits(parts[3] ?? '').padStart(3, '0')

  // Permitimos DNI (8) o CUIL (11). La lógica de consulta/validación se aplica más adelante.
  if (!/^\d{8}$/.test(documento) && !/^\d{11}$/.test(documento)) return null
  if (!isValidYYYYMM(periodoDesde) || !isValidYYYYMM(periodoHasta)) return null
  if (!/^\d{3}$/.test(secuencia)) return null
  if (periodoDesde > periodoHasta) return null
  if (isFutureYYYYMM(periodoHasta, maxYYYYMM)) return null

  return { documento, periodoDesde, periodoHasta, secuencia }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { file, maxYYYYMM } = event.data

  const startMs = Date.now()
  let lastProgressPercent = 0
  let lastProgressAt = 0
  const seenRows = new Set<string>()
  const seenDocs = new Set<string>()
  const invalidLines: string[] = []
  const duplicateRows: string[] = []
  const rows: ParseSercopeRow[] = []
  const documentos: string[] = []
  let totalLines = 0

  const postProgress = (cursor: number, rowsCount: number) => {
    const percent =
      file.size > 0 ? Math.min(100, Math.round((cursor / Math.max(1, file.size)) * 100)) : 0
    const now = Date.now()
    if (percent === lastProgressPercent && now - lastProgressAt < 200) return
    lastProgressPercent = percent
    lastProgressAt = now
    const message: WorkerProgress = { type: 'progress', progress: { percent, rows: rowsCount } }
    self.postMessage(message)
  }

  Papa.parse<string[]>(file, {
    skipEmptyLines: 'greedy',
    delimiter: '',
    chunk: (results) => {
      const rawRows = Array.isArray(results.data) ? results.data : []
      for (const raw of rawRows) {
        if (!Array.isArray(raw)) continue
        const parts = raw.map((value) => String(value ?? '').trim())
        if (parts.length === 0 || parts.every((value) => !value)) continue
        totalLines += 1
        if (isHeaderRow(parts)) continue

        const row = normalizeRow(parts, maxYYYYMM)
        if (!row) {
          invalidLines.push(parts.join(','))
          continue
        }

        const key = `${row.documento}-${row.periodoDesde}-${row.periodoHasta}-${row.secuencia}`
        if (seenRows.has(key)) {
          duplicateRows.push(key)
          continue
        }

        seenRows.add(key)
        rows.push(row)
        if (!seenDocs.has(row.documento)) {
          seenDocs.add(row.documento)
          documentos.push(row.documento)
        }
      }

      const cursor = typeof results.meta?.cursor === 'number' ? results.meta.cursor : 0
      postProgress(cursor, totalLines)
    },
    complete: () => {
      postProgress(file.size, totalLines)
      const parseMs = Date.now() - startMs
      const result: ParseSercopeCsvResult = {
        rows,
        documentos,
        invalidLines,
        duplicateRows,
        report: {
          totalLines,
          valid: rows.length,
          invalid: invalidLines.length,
          duplicates: duplicateRows.length,
          parseMs,
          rowsPerSec: totalLines > 0 ? Math.round((totalLines / Math.max(1, parseMs)) * 1000) : 0,
        },
      }
      const message: WorkerSuccess = { type: 'success', result }
      self.postMessage(message)
    },
    error: (error) => {
      const message: WorkerError = { type: 'error', message: error.message || 'Error al leer el CSV' }
      self.postMessage(message)
    },
  })
}
