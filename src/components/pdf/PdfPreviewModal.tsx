import { useEffect, useMemo, useState } from 'react'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { createPdfBlobUrl, downloadPdf } from '../../pdf/render'

export function PdfPreviewModal({
  doc,
  filename,
  metaLabel,
  onClose,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  onPrevAgent,
  onNextAgent,
  hasPrevAgent = false,
  hasNextAgent = false,
  onSearch,
}: {
  doc: TDocumentDefinitions
  filename: string
  metaLabel?: string
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
  onPrevAgent?: () => void
  onNextAgent?: () => void
  hasPrevAgent?: boolean
  hasNextAgent?: boolean
  onSearch?: (query: string) => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const stableDoc = useMemo(() => doc, [doc])

  useEffect(() => {
    let active = true
    let createdUrl: string | null = null
    void (async () => {
      try {
        const nextUrl = await createPdfBlobUrl(stableDoc)
        if (!active) return
        createdUrl = nextUrl
        setUrl(nextUrl)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'No se pudo generar el PDF')
      }
    })()

    return () => {
      active = false
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [stableDoc])

  return (
    <Modal title="Vista previa del PDF" onClose={onClose}>
      <div className="flex flex-col gap-2 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            {metaLabel ? <p className="text-sm font-semibold text-gray-900">{metaLabel}</p> : null}
            <p className="text-xs text-gray-700">
              Podés revisar el PDF y luego descargarlo. Si el PDF está vacío, revisá filtros/períodos.
            </p>
            {onSearch ? (
              <div className="flex items-center gap-2 pt-1">
                <input
                  className="h-7 w-48 rounded-md border border-gray-300 px-2 text-xs text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Buscar agente o período…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && search.trim() && onSearch) {
                      onSearch(search.trim())
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-7 px-2 text-[11px]"
                  disabled={!search.trim()}
                  onClick={() => {
                    if (search.trim() && onSearch) onSearch(search.trim())
                  }}
                >
                  Ir
                </Button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1 text-xs">
            {(onPrevAgent || onNextAgent) && (
              <div className="flex items-center gap-1">
                <span className="text-gray-600">Agente</span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onPrevAgent}
                  disabled={!hasPrevAgent}
                  className="h-7 px-2 text-[11px]"
                >
                  ◀
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onNextAgent}
                  disabled={!hasNextAgent}
                  className="h-7 px-2 text-[11px]"
                >
                  ▶
                </Button>
              </div>
            )}
            <div className="flex items-center gap-1">
              <span className="text-gray-600">Período / página</span>
              <Button
                type="button"
                variant="secondary"
                onClick={onPrev}
                disabled={!hasPrev}
                className="h-7 px-2 text-[11px]"
              >
                ◀
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={onNext}
                disabled={!hasNext}
                className="h-7 px-2 text-[11px]"
              >
                ▶
              </Button>
              <Button type="button" onClick={() => downloadPdf(stableDoc, filename)} className="h-7 px-3 text-[11px]">
                Descargar
              </Button>
            </div>
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {url ? (
        <iframe
          title="Preview PDF"
          src={url}
          className="h-[70vh] w-full rounded-md ring-1 ring-gray-200"
        />
      ) : (
        <div className="flex h-[70vh] items-center justify-center rounded-md bg-gray-50 ring-1 ring-gray-200">
          <p className="text-sm text-gray-600">Generando PDF…</p>
        </div>
      )}
    </Modal>
  )
}
