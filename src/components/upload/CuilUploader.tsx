import { useCallback, useMemo, useRef, useState } from 'react'
import {
  parseSercopeCsvDetailed,
  type ParseCuilReport,
  type ParseSercopeRow,
} from '../../utils/txtParser'
import { expandYYYYMMRange } from '../../utils/period'

export interface SercopeUploadPayload {
  documentos: string[]
  rows: ParseSercopeRow[]
  periodos: string[]
  report: ParseCuilReport
}

export interface CuilUploaderProps {
  onParsed: (payload: SercopeUploadPayload) => void
}

export function CuilUploader({ onParsed }: CuilUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ParseCuilReport | null>(null)
  const [parseProgress, setParseProgress] = useState<{ percent: number; rows: number } | null>(null)

  const [lastRows, setLastRows] = useState<ParseSercopeRow[] | null>(null)

  const derivedPeriods = useMemo(() => {
    if (!lastRows) return []
    const set = new Set<string>()
    for (const r of lastRows) {
      for (const p of expandYYYYMMRange(r.periodoDesde, r.periodoHasta)) set.add(p)
    }
    return Array.from(set).sort()
  }, [lastRows])

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        setError('Solo se permiten archivos .csv')
        return
      }

      try {
        setParseProgress({ percent: 0, rows: 0 })
        const detailed = await parseSercopeCsvDetailed(file, {
          onProgress: (progress) => setParseProgress(progress),
        })
        setReport(detailed.report)
        setLastRows(detailed.rows)

        if (detailed.rows.length === 0) {
          setError('El archivo está vacío o no contiene filas válidas')
          onParsed({ documentos: [], rows: [], periodos: [], report: detailed.report })
          return
        }

        const set = new Set<string>()
        for (const r of detailed.rows) {
          for (const p of expandYYYYMMRange(r.periodoDesde, r.periodoHasta)) set.add(p)
        }
        const periodos = Array.from(set).sort()

        setError(null)
        onParsed({ documentos: detailed.documentos, rows: detailed.rows, periodos, report: detailed.report })
        setParseProgress(null)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Error al leer el archivo')
        setParseProgress(null)
      }
    },
    [onParsed],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (file) void handleFile(file)
    },
    [handleFile],
  )

  const onPick = useCallback(() => inputRef.current?.click(), [])

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) void handleFile(file)
      e.target.value = ''
    },
    [handleFile],
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-900">Archivo Sercope (CSV)</label>
          <p className="text-xs text-gray-600">
            Columnas: Documento (8), PeriodoDesde (YYYYMM), PeriodoHasta (YYYYMM), Secuencia (000). No
            se permiten períodos futuros.
          </p>
        </div>
        <button
          type="button"
          onClick={onPick}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50"
        >
          Seleccionar archivo
        </button>
      </div>

      <div
        className="rounded-lg border-2 border-dashed border-gray-300 bg-white px-6 py-10 text-center transition-colors hover:border-blue-400"
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={onPick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onPick()
        }}
        aria-label="Zona de carga de CSV"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={onChange}
        />
        <p className="text-sm font-medium text-gray-900">Arrastrá y soltá el CSV acá</p>
        <p className="mt-1 text-xs text-gray-600">o hacé click para seleccionar</p>
      </div>

      {report ? (
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
          <div className="rounded-md bg-gray-50 p-3 ring-1 ring-gray-200">
            <div className="text-xs text-gray-600">Líneas</div>
            <div className="font-semibold text-gray-900">{report.totalLines}</div>
          </div>
          <div className="rounded-md bg-gray-50 p-3 ring-1 ring-gray-200">
            <div className="text-xs text-gray-600">Válidos</div>
            <div className="font-semibold text-gray-900">{report.valid}</div>
          </div>
          <div className="rounded-md bg-gray-50 p-3 ring-1 ring-gray-200">
            <div className="text-xs text-gray-600">Inválidos</div>
            <div className="font-semibold text-gray-900">{report.invalid}</div>
          </div>
          <div className="rounded-md bg-gray-50 p-3 ring-1 ring-gray-200">
            <div className="text-xs text-gray-600">Duplicados</div>
            <div className="font-semibold text-gray-900">{report.duplicates}</div>
          </div>
          {typeof report.parseMs === 'number' ? (
            <div className="rounded-md bg-gray-50 p-3 ring-1 ring-gray-200">
              <div className="text-xs text-gray-600">Tiempo</div>
              <div className="font-semibold text-gray-900">{(report.parseMs / 1000).toFixed(2)}s</div>
            </div>
          ) : null}
          {typeof report.rowsPerSec === 'number' ? (
            <div className="rounded-md bg-gray-50 p-3 ring-1 ring-gray-200">
              <div className="text-xs text-gray-600">Filas/seg</div>
              <div className="font-semibold text-gray-900">
                {report.rowsPerSec.toLocaleString('es-AR')}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {derivedPeriods.length > 0 ? (
        <p className="text-xs text-gray-600">
          Períodos derivados del CSV: <span className="font-medium">{derivedPeriods.length}</span>
        </p>
      ) : null}

      {parseProgress ? (
        <p className="text-xs text-gray-600">
          Procesando CSV: <span className="font-medium">{parseProgress.percent}%</span> ·{' '}
          {parseProgress.rows.toLocaleString('es-AR')} filas
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  )
}
