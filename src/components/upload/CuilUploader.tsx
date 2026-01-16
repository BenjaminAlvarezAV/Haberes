import { useCallback, useRef, useState } from 'react'
import { parseCuilTxtDetailed, type ParseCuilReport } from '../../utils/txtParser'

export interface CuilUploaderProps {
  onCuilsParsed: (cuils: string[], report: ParseCuilReport) => void
}

export function CuilUploader({ onCuilsParsed }: CuilUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ParseCuilReport | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.txt')) {
        setError('Solo se permiten archivos .txt')
        return
      }

      try {
        const detailed = await parseCuilTxtDetailed(file)
        setReport(detailed.report)

        if (detailed.cuils.length === 0) {
          setError('El archivo está vacío o no contiene CUILs válidos')
          onCuilsParsed([], detailed.report)
          return
        }

        setError(null)
        onCuilsParsed(detailed.cuils, detailed.report)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Error al leer el archivo')
      }
    },
    [onCuilsParsed],
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
          <label className="block text-sm font-medium text-gray-900">Nómina (TXT)</label>
          <p className="text-xs text-gray-600">
            Un CUIL por línea. Se toleran espacios/guiones. Se deduplican.
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
        aria-label="Zona de carga de TXT"
      >
        <input ref={inputRef} type="file" accept=".txt" className="hidden" onChange={onChange} />
        <p className="text-sm font-medium text-gray-900">Arrastrá y soltá el TXT acá</p>
        <p className="mt-1 text-xs text-gray-600">o hacé click para seleccionar</p>
      </div>

      {report ? (
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
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
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  )
}
