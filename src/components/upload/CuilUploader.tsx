import { useCallback, useMemo, useRef, useState } from 'react'
import {
  parseSercopeCsvDetailed,
  type ParseCuilReport,
  type ParseSercopeRow,
} from '../../utils/txtParser'
import { expandYYYYMMRange } from '../../utils/period'

export interface SercopeUploadPayload {
  fileName: string
  documentos: string[]
  rows: ParseSercopeRow[]
  periodos: string[]
  report: ParseCuilReport
}

export interface CuilUploaderProps {
  onParsed: (payload: SercopeUploadPayload) => void
  sources?: { name: string; documentos: number; periodos: number }[]
  onRemoveSource?: (index: number) => void
  /** Si es true, no se puede cargar otro CSV (p. ej. modo manual). Los ya cargados siguen listados. */
  disabled?: boolean
}

export function CuilUploader({ onParsed, sources, onRemoveSource, disabled = false }: CuilUploaderProps) {
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
      if (disabled) return
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
          onParsed({ fileName: file.name, documentos: [], rows: [], periodos: [], report: detailed.report })
          return
        }

        const set = new Set<string>()
        for (const r of detailed.rows) {
          for (const p of expandYYYYMMRange(r.periodoDesde, r.periodoHasta)) set.add(p)
        }
        const periodos = Array.from(set).sort()

        setError(null)
        onParsed({
          fileName: file.name,
          documentos: detailed.documentos,
          rows: detailed.rows,
          periodos,
          report: detailed.report,
        })
        setParseProgress(null)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Error al leer el archivo')
        setParseProgress(null)
      }
    },
    [disabled, onParsed],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      if (disabled) return
      const file = e.dataTransfer.files?.[0]
      if (file) void handleFile(file)
    },
    [disabled, handleFile],
  )

  const onPick = useCallback(() => {
    if (disabled) return
    inputRef.current?.click()
  }, [disabled])

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) {
        e.target.value = ''
        return
      }
      const file = e.target.files?.[0]
      if (file) void handleFile(file)
      e.target.value = ''
    },
    [disabled, handleFile],
  )

  return (
    <div className="space-y-3">
      <div
        className={`space-y-3 ${
          disabled
            ? 'pointer-events-none select-none rounded-lg border border-gray-200 bg-gray-100 p-3 opacity-60 saturate-0'
            : ''
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <label
              className={`block text-sm font-medium ${disabled ? 'text-gray-500' : 'text-gray-900'}`}
            >
              Archivo Sercope (CSV)
            </label>
            <p className={`text-xs ${disabled ? 'text-gray-500' : 'text-gray-600'}`}>
              Columnas: Documento (DNI 8 o CUIL 11), PeriodoDesde (YYYYMM), PeriodoHasta (YYYYMM),
              Secuencia (000). No se permiten períodos futuros.
            </p>
          </div>
          <button
            type="button"
            onClick={onPick}
            disabled={disabled}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-200 disabled:text-gray-500"
          >
            Seleccionar archivo
          </button>
        </div>

        <div
          className={`rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
            disabled
              ? 'cursor-not-allowed border-gray-300/80 bg-gray-200/50'
              : 'border-gray-300 bg-white hover:border-blue-400'
          }`}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={disabled ? undefined : onPick}
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === 'Enter' || e.key === ' ') onPick()
        }}
        aria-disabled={disabled}
        aria-label={disabled ? 'Carga de CSV no disponible' : 'Zona de carga de CSV'}
      >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            disabled={disabled}
            onChange={onChange}
          />
          <p className={`text-sm font-medium ${disabled ? 'text-gray-500' : 'text-gray-900'}`}>
            Arrastrá y soltá el CSV acá
          </p>
          <p className={`mt-1 text-xs ${disabled ? 'text-gray-500' : 'text-gray-600'}`}>
            o hacé click para seleccionar
          </p>
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
          <p className={`text-xs ${disabled ? 'text-gray-500' : 'text-gray-600'}`}>
            Períodos derivados del CSV: <span className="font-medium">{derivedPeriods.length}</span>
          </p>
        ) : null}
      </div>

      {sources && sources.length > 0 ? (
        <div className="space-y-1 text-xs text-gray-700">
          <p className="font-medium">CSV cargados en esta sesión:</p>
          <ul className="space-y-0.5">
            {sources.map((f, idx) => (
              <li key={`${f.name}-${idx}`} className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono">{f.name}</span>{' '}
                  <span className="text-gray-600">
                    – {f.documentos} documento(s), {f.periodos} período(s)
                  </span>
                </div>
                {onRemoveSource ? (
                  <button
                    type="button"
                    className="rounded px-1 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-red-600"
                    aria-label={`Quitar CSV ${f.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveSource(idx)
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
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
