import { useCallback, useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { CuilUploader, type SercopeUploadPayload } from '../../components/upload/CuilUploader'
import { PeriodSelector } from '../../components/filters/PeriodSelector'
import { GroupToggle } from '../../components/results/GroupToggle'
import { ResultsTable } from '../../components/results/ResultsTable'
import { PdfPreviewModal } from '../../components/pdf/PdfPreviewModal'
import { usePayroll } from '../../hooks/usePayroll'
import { buildAgentPdfs, buildPeriodPdfs } from '../../pdf/builders'
import type { AgentPdf, PeriodPdf } from '../../pdf/builders'
import { createPdfBase64, downloadBlob } from '../../pdf/render'
import { groupByAgent, groupByPeriod } from '../../utils/grouping'
import type { GroupedByAgent, GroupedByPeriod } from '../../utils/grouping'

type PdfEntry = AgentPdf | PeriodPdf

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isGroupedByAgent(grouped: GroupedByAgent | GroupedByPeriod | null): grouped is GroupedByAgent {
  return Boolean(grouped && 'orderedCuils' in grouped)
}

function isGroupedByPeriod(grouped: GroupedByAgent | GroupedByPeriod | null): grouped is GroupedByPeriod {
  return Boolean(grouped && 'orderedPeriods' in grouped)
}

function pdfFilename(pdf: PdfEntry): string {
  return 'cuil' in pdf ? `haberes-${pdf.cuil}.pdf` : `haberes-${pdf.periodo}.pdf`
}

function matchesSearch(value: string, term: string): boolean {
  if (!term) return true
  return value.toLowerCase().includes(term)
}

const PDF_TIMEOUT_MS = 60000

async function createPdfBase64WithTimeout(doc: PdfEntry['doc'], ms: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    createPdfBase64(doc)
      .then((data) => {
        clearTimeout(timer)
        resolve(data)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

export function PayrollPage() {
  const {
    cuils,
    periodos,
    groupMode,
    loading,
    error,
    data,
    dispatch,
    consult,
    lastUploadReport,
  } = usePayroll()

  const [pdfOpen, setPdfOpen] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadingZip, setDownloadingZip] = useState(false)
  const [zipBlob, setZipBlob] = useState<Blob | null>(null)
  const [zipName, setZipName] = useState<string | null>(null)
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number; label: string } | null>(
    null,
  )
  const [zipSkipped, setZipSkipped] = useState<string[]>([])

  const grouped = useMemo(() => {
    if (!data) return null
    return groupMode === 'agent' ? groupByAgent(data) : groupByPeriod(data)
  }, [data, groupMode])

  const normalizedSearch = useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm])
  const agentPdfs = useMemo(() => (data ? buildAgentPdfs(data) : []), [data])
  const periodPdfs = useMemo(() => (data ? buildPeriodPdfs(data) : []), [data])
  const allPdfs = groupMode === 'agent' ? agentPdfs : periodPdfs
  const pdfs = useMemo(() => {
    if (!normalizedSearch) return allPdfs
    return allPdfs.filter((pdf) =>
      matchesSearch('cuil' in pdf ? pdf.cuil : pdf.periodo, normalizedSearch),
    )
  }, [allPdfs, normalizedSearch])
  const preview = pdfs[previewIndex] ?? null

  const filteredAgentKeys = useMemo(() => {
    if (!isGroupedByAgent(grouped)) return []
    if (!normalizedSearch) return grouped.orderedCuils
    return grouped.orderedCuils.filter((cuil) => matchesSearch(cuil, normalizedSearch))
  }, [grouped, normalizedSearch])

  const filteredPeriodKeys = useMemo(() => {
    if (!isGroupedByPeriod(grouped)) return []
    if (!normalizedSearch) return grouped.orderedPeriods
    return grouped.orderedPeriods.filter((period) => matchesSearch(period, normalizedSearch))
  }, [grouped, normalizedSearch])

  const totalPages = groupMode === 'agent' ? filteredAgentKeys.length : filteredPeriodKeys.length
  const currentKey =
    groupMode === 'agent' ? filteredAgentKeys[pageIndex] : filteredPeriodKeys[pageIndex]

  const onCsvParsed = useCallback(
    (payload: SercopeUploadPayload) => {
      // Guardamos documentos en el estado (reutilizamos cuils como identificador)
      dispatch({ type: 'SET_CUILS', payload: { cuils: payload.documentos, report: payload.report } })
      // Derivamos períodos del CSV y los seteamos (editable desde el selector)
      dispatch({ type: 'SET_PERIODOS', payload: payload.periodos })
    },
    [dispatch],
  )

  useEffect(() => {
    if (previewIndex >= pdfs.length && pdfs.length > 0) {
      setPreviewIndex(0)
    }
  }, [pdfs.length, previewIndex])

  useEffect(() => {
    if (pageIndex >= totalPages && totalPages > 0) {
      setPageIndex(0)
    }
  }, [pageIndex, totalPages])

  useEffect(() => {
    if (!zipBlob || !zipName) return
    downloadBlob(zipBlob, zipName)
    setZipBlob(null)
    setZipName(null)
  }, [zipBlob, zipName])

  const downloadAllPdfs = useCallback(async () => {
    if (!data) return

    try {
      setDownloadError(null)
      setDownloadingZip(true)
      setZipBlob(null)
      setZipName(null)
      setZipProgress(null)
      setZipSkipped([])
      let docs: PdfEntry[] = groupMode === 'agent' ? buildAgentPdfs(data) : buildPeriodPdfs(data)
      if (normalizedSearch) {
        docs = docs.filter((pdf) =>
          matchesSearch('cuil' in pdf ? pdf.cuil : pdf.periodo, normalizedSearch),
        )
      }
      if (docs.length === 0) return

      const zip = new JSZip()
      let added = 0
      const skipped: string[] = []
      for (let i = 0; i < docs.length; i += 1) {
        const d = docs[i]
        const filename = pdfFilename(d)
        setZipProgress({ current: i + 1, total: docs.length, label: filename })
        try {
          const base64 = await createPdfBase64WithTimeout(d.doc, PDF_TIMEOUT_MS)
          zip.file(filename, base64, { base64: true })
          added += 1
          await sleep(50)
        } catch (err) {
          console.error('Error al generar PDF para ZIP', filename, err)
          const reason =
            err instanceof Error
              ? err.message === 'timeout'
                ? 'timeout'
                : err.message
              : 'error'
          skipped.push(`${filename} (${reason})`)
        }
      }

      setZipSkipped(skipped)
      if (added === 0) {
        setDownloadError('No se pudo generar ningún PDF para el ZIP.')
        return
      }

      const nextZipName = groupMode === 'agent' ? 'haberes-por-agente.zip' : 'haberes-por-periodo.zip'
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      setZipBlob(zipBlob)
      setZipName(nextZipName)
    } catch (e) {
      console.error('Error al generar ZIP de PDFs', e)
      const message =
        e instanceof Error && e.message === 'timeout'
          ? 'Tiempo de espera agotado para algún PDF.'
          : null
      setDownloadError(
        `No se pudo generar el ZIP.${message ? ` ${message}` : ''} Revisá el filtro y volvé a intentar.`,
      )
    } finally {
      setDownloadingZip(false)
      setZipProgress(null)
    }
  }, [data, groupMode, normalizedSearch])

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-gray-900">Sistema de Consulta de Haberes Docentes</h1>
          <p className="text-sm text-gray-600">
            Cargá un CSV (Sercope), revisá períodos (sin futuros) y consultá liquidaciones para generar PDFs.
          </p>
        </header>

        <Card title="Entrada de datos">
          <div className="grid gap-6 lg:grid-cols-2">
            <CuilUploader onParsed={onCsvParsed} />

            <div className="space-y-4">
              <PeriodSelector
                value={periodos}
                onChange={(next) => dispatch({ type: 'SET_PERIODOS', payload: next })}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => void consult()} disabled={loading}>
                  {loading ? 'Consultando' : 'Consultar'}
                </Button>
                <div className="text-sm text-gray-700">
                  <span className="font-medium">{cuils.length}</span> documentos {' '}
                  <span className="font-medium">{periodos.length}</span> período(s)
                </div>
              </div>

              {lastUploadReport ? (
                <p className="text-xs text-gray-600">
                  Último CSV: {lastUploadReport.valid} válidos, {lastUploadReport.invalid} inválidos,{' '}
                  {lastUploadReport.duplicates} duplicados.
                </p>
              ) : null}

              {error ? (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
                  {error.message}
                </div>
              ) : null}
            </div>
          </div>
        </Card>

        {data ? (
          <Card>
            <div className="space-y-4">
              <GroupToggle
                value={groupMode}
                onChange={(mode) => dispatch({ type: 'SET_GROUP_MODE', payload: mode })}
              />

              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value)
                    setPageIndex(0)
                    setPreviewIndex(0)
                  }}
                  placeholder={groupMode === 'agent' ? 'Buscar por CUIL…' : 'Buscar por período (YYYY-MM)…'}
                />
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span>
                    {totalPages === 0
                      ? 'Sin resultados'
                      : `Página ${pageIndex + 1} de ${totalPages}`}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPageIndex((idx) => Math.max(0, idx - 1))}
                    disabled={totalPages === 0 || pageIndex === 0}
                  >
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPageIndex((idx) => Math.min(totalPages - 1, idx + 1))}
                    disabled={totalPages === 0 || pageIndex >= totalPages - 1}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>

              {data.errors && data.errors.length > 0 ? (
                <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
                  Se detectaron {data.errors.length} observaciones al normalizar la respuesta.
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => {
                    setPreviewIndex(0)
                    setPdfOpen(true)
                  }}
                  disabled={!preview || (data.items?.length ?? 0) === 0}
                >
                  Vista previa PDF (primer grupo)
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void downloadAllPdfs()}
                  disabled={pdfs.length === 0 || downloadingZip}
                >
                  {downloadingZip ? 'Generando ZIP…' : 'Descargar PDFs (ZIP)'}
                </Button>
                <span className="text-xs text-gray-600 self-center">
                  {pdfs.length} PDF(s)
                </span>
              </div>
              {zipProgress ? (
                <p className="text-xs text-gray-600">
                  Generando ZIP: {zipProgress.current}/{zipProgress.total} — {zipProgress.label}
                </p>
              ) : null}
              {downloadError ? (
                <p className="text-xs text-red-600">{downloadError}</p>
              ) : null}
              {zipSkipped.length > 0 ? (
                <p className="text-xs text-amber-700">
                  Se omitieron {zipSkipped.length} PDF(s): {zipSkipped.slice(0, 5).join(', ')}
                  {zipSkipped.length > 5 ? '…' : ''}
                </p>
              ) : null}

              {groupMode === 'agent' && isGroupedByAgent(grouped) && currentKey ? (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-gray-900">Agente {currentKey}</h4>
                      <span className="text-xs text-gray-600">{grouped.byCuil[currentKey].length} ítems</span>
                    </div>
                    <ResultsTable items={grouped.byCuil[currentKey]} />
                  </div>
                </div>
              ) : null}

              {groupMode === 'period' && isGroupedByPeriod(grouped) && currentKey ? (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-gray-900">Período {currentKey}</h4>
                      <span className="text-xs text-gray-600">{grouped.byPeriod[currentKey].length} ítems</span>
                    </div>
                    <ResultsTable items={grouped.byPeriod[currentKey]} />
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}

        {pdfOpen && preview ? (
          <PdfPreviewModal
            doc={preview.doc}
            filename={pdfFilename(preview)}
            onClose={() => setPdfOpen(false)}
            onPrev={() => setPreviewIndex((idx) => Math.max(0, idx - 1))}
            onNext={() => setPreviewIndex((idx) => Math.min(pdfs.length - 1, idx + 1))}
            hasPrev={previewIndex > 0}
            hasNext={previewIndex < pdfs.length - 1}
          />
        ) : null}
      </div>
    </div>
  )
}
