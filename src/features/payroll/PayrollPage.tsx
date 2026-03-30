import { useCallback, useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { DatePicker } from '../../components/ui/DatePicker'
import { CuilUploader, type SercopeUploadPayload } from '../../components/upload/CuilUploader'
import { PeriodSelector } from '../../components/filters/PeriodSelector'
import { GroupToggle } from '../../components/results/GroupToggle'
import { ResultsTable } from '../../components/results/ResultsTable'
import { PdfPreviewModal } from '../../components/pdf/PdfPreviewModal'
import { usePayroll } from '../../hooks/usePayroll'
import { buildAgentPdfs, buildPeriodPdfs } from '../../pdf/builders'
import type { AgentPeriodPdf, PeriodPdf } from '../../pdf/builders'
import { createPdfBase64, downloadBlob } from '../../pdf/render'
import { groupByAgent, groupByPeriod } from '../../utils/grouping'
import type { GroupedByAgent, GroupedByPeriod } from '../../utils/grouping'
import { currentPeriod, expandPeriodRange } from '../../utils/period'

type PdfEntry = AgentPeriodPdf | PeriodPdf

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
  if ('cuil' in pdf && 'periodo' in pdf) {
    return `haberes-${pdf.cuil}-${pdf.periodo}.pdf`
  }
  if ('cuil' in pdf) return `haberes-${pdf.cuil}.pdf`
  return `haberes-${pdf.periodo}.pdf`
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

function shiftMonthYear(value: string, yearsDelta: number): string {
  const safe = value && /^\d{4}-\d{2}$/.test(value) ? value : currentPeriod()
  const year = Number(safe.slice(0, 4)) + yearsDelta
  const month = safe.slice(5, 7)
  return `${year}-${month}`
}

function periodToInputDate(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return ''
  return `${period}-01`
}

function inputDateToPeriod(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  return value.slice(0, 7)
}

function shiftSearchDateYear(value: string, yearsDelta: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const [y, m, d] = value.split('-').map((v) => Number(v))
  const date = new Date(y + yearsDelta, m - 1, d)
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export function PayrollPage() {
  const {
    cuils,
    availablePeriodos,
    periodos,
    batchUseManualPeriods,
    queryMode,
    manualCuil,
    manualMonth,
    manualFrom,
    manualTo,
    groupMode,
    loading,
    error,
    data,
    chequesByKey,
    dispatch,
    consult,
    lastUploadReport,
    fetchProgress,
    csvSources,
    dataStale,
  } = usePayroll()

  const [pdfOpen, setPdfOpen] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [agentSearch, setAgentSearch] = useState('')
  // Usamos input type="date" para selección (día/mes/año) y derivamos YYYY-MM para filtrar.
  const [periodSearchDate, setPeriodSearchDate] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadingZip, setDownloadingZip] = useState(false)
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number; label: string } | null>(
    null,
  )
  const [zipSkipped, setZipSkipped] = useState<string[]>([])
  const [showErrorDetails, setShowErrorDetails] = useState(false)

  const normalizedAgentSearch = useMemo(() => agentSearch.trim().toLowerCase(), [agentSearch])
  const normalizedPeriodSearch = useMemo(() => {
    const raw = periodSearchDate.trim()
    // YYYY-MM-DD -> YYYY-MM
    return raw.length >= 7 ? raw.slice(0, 7).toLowerCase() : ''
  }, [periodSearchDate])

  // Filtro dual: aplica en paralelo por agente/documento y por período (independiente del modo).
  const filteredData = useMemo(() => {
    if (!data) return null

    let items = data.items
    if (normalizedAgentSearch) {
      items = items.filter((it) => it.cuil.toLowerCase().startsWith(normalizedAgentSearch))
    }
    if (normalizedPeriodSearch) {
      items = items.filter((it) => it.periodo.toLowerCase().includes(normalizedPeriodSearch))
    }

    const used = new Set(items.map((it) => it.cuil))
    const agents = data.agents.filter((a) => used.has(a.cuil))

    return { ...data, items, agents }
  }, [data, normalizedAgentSearch, normalizedPeriodSearch])

  const grouped = useMemo(() => {
    if (!filteredData) return null
    return groupMode === 'agent' ? groupByAgent(filteredData) : groupByPeriod(filteredData)
  }, [filteredData, groupMode])

  const agentPdfs = useMemo(
    () => (filteredData ? buildAgentPdfs(filteredData, chequesByKey) : []),
    [filteredData, chequesByKey],
  )
  const periodPdfs = useMemo(
    () => (filteredData ? buildPeriodPdfs(filteredData, chequesByKey) : []),
    [filteredData, chequesByKey],
  )
  const chequesErrorCount = useMemo(
    () => Object.values(chequesByKey).filter((bundle) => bundle.errors && bundle.errors.length > 0).length,
    [chequesByKey],
  )
  // Vista previa: siempre misma lista que en modo por agente (1 PDF por agente × período),
  // así la navegación Agente / Período y la búsqueda son iguales con cualquier agrupación en pantalla.
  const previewPdfs = agentPdfs
  const zipPdfCount = groupMode === 'agent' ? agentPdfs.length : periodPdfs.length
  const preview = previewPdfs[previewIndex] ?? null

  const hasPrevPeriodInAgent = useMemo(() => {
    if (!preview || !('cuil' in preview) || !('periodo' in preview)) return false
    for (let i = previewIndex - 1; i >= 0; i -= 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && 'periodo' in p && p.cuil === preview.cuil && p.periodo !== preview.periodo) return true
    }
    return false
  }, [previewPdfs, preview, previewIndex])

  const hasNextPeriodInAgent = useMemo(() => {
    if (!preview || !('cuil' in preview) || !('periodo' in preview)) return false
    for (let i = previewIndex + 1; i < previewPdfs.length; i += 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && 'periodo' in p && p.cuil === preview.cuil && p.periodo !== preview.periodo) return true
    }
    return false
  }, [previewPdfs, preview, previewIndex])

  const handlePrevPeriodInAgent = useCallback(() => {
    if (!preview || !('cuil' in preview) || !('periodo' in preview)) return
    for (let i = previewIndex - 1; i >= 0; i -= 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && 'periodo' in p && p.cuil === preview.cuil && p.periodo !== preview.periodo) {
        setPreviewIndex(i)
        return
      }
    }
  }, [previewPdfs, preview, previewIndex])

  const handleNextPeriodInAgent = useCallback(() => {
    if (!preview || !('cuil' in preview) || !('periodo' in preview)) return
    for (let i = previewIndex + 1; i < previewPdfs.length; i += 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && 'periodo' in p && p.cuil === preview.cuil && p.periodo !== preview.periodo) {
        setPreviewIndex(i)
        return
      }
    }
  }, [previewPdfs, preview, previewIndex])

  const hasPrevAgent = useMemo(() => {
    if (!preview || !('cuil' in preview)) return false
    for (let i = previewIndex - 1; i >= 0; i -= 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && p.cuil !== preview.cuil) return true
    }
    return false
  }, [previewPdfs, preview, previewIndex])

  const hasNextAgent = useMemo(() => {
    if (!preview || !('cuil' in preview)) return false
    for (let i = previewIndex + 1; i < previewPdfs.length; i += 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && p.cuil !== preview.cuil) return true
    }
    return false
  }, [previewPdfs, preview, previewIndex])

  const handlePrevAgent = useCallback(() => {
    if (!preview || !('cuil' in preview)) return
    let prevAgentCuil: string | null = null
    for (let i = previewIndex - 1; i >= 0; i -= 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && p.cuil !== preview.cuil) {
        prevAgentCuil = p.cuil
        break
      }
    }
    if (!prevAgentCuil) return
    for (let i = 0; i < previewPdfs.length; i += 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && p.cuil === prevAgentCuil) {
        setPreviewIndex(i)
        return
      }
    }
  }, [previewPdfs, preview, previewIndex])

  const handleNextAgent = useCallback(() => {
    if (!preview || !('cuil' in preview)) return
    let nextAgentCuil: string | null = null
    for (let i = previewIndex + 1; i < previewPdfs.length; i += 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && p.cuil !== preview.cuil) {
        nextAgentCuil = p.cuil
        break
      }
    }
    if (!nextAgentCuil) return
    for (let i = 0; i < previewPdfs.length; i += 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && p.cuil === nextAgentCuil) {
        setPreviewIndex(i)
        return
      }
    }
  }, [previewPdfs, preview, previewIndex])

  const handlePreviewSearch = useCallback(
    (query: string) => {
      const q = query.trim().toLowerCase()
      if (!q) return

      let targetIndex = previewPdfs.findIndex(
        (p) =>
          p.cuil.toLowerCase().startsWith(q) || p.periodo.toLowerCase().startsWith(q),
      )
      if (targetIndex === -1) {
        targetIndex = previewPdfs.findIndex((p) => p.periodo.toLowerCase().includes(q))
      }
      if (targetIndex !== -1) setPreviewIndex(targetIndex)
    },
    [previewPdfs],
  )

  const keys = useMemo(() => {
    if (groupMode === 'agent') return isGroupedByAgent(grouped) ? grouped.orderedCuils : []
    return isGroupedByPeriod(grouped) ? grouped.orderedPeriods : []
  }, [groupMode, grouped])

  const totalPages = keys.length
  const currentKey = keys[pageIndex] ?? null

  const onCsvParsed = useCallback(
    (payload: SercopeUploadPayload) => {
      if (queryMode === 'manual') return
      dispatch({
        type: 'ADD_CSV_SOURCE',
        payload: {
          name: payload.fileName,
          documentos: payload.documentos,
          rows: payload.rows,
          periodos: payload.periodos,
          report: payload.report,
        },
      })
    },
    [dispatch, queryMode],
  )

  const manualIdValid = useMemo(() => {
    const v = manualCuil.trim()
    return /^\d+$/.test(v) && (v.length === 8 || v.length === 11)
  }, [manualCuil])

  const manualPeriodos = useMemo(() => {
    // En modo manual derivamos siempre del rango DESDE-HASTA.
    if (manualFrom && manualTo) {
      return expandPeriodRange(manualFrom, manualTo)
    }
    return []
  }, [manualFrom, manualTo])

  const effectiveDocCount = queryMode === 'manual' ? (manualIdValid ? 1 : 0) : cuils.length
  const effectivePeriodCount =
    queryMode === 'manual' ? manualPeriodos.length : batchUseManualPeriods ? periodos.length : availablePeriodos.length

  useEffect(() => {
    if (previewIndex >= previewPdfs.length && previewPdfs.length > 0) {
      setPreviewIndex(0)
    }
  }, [previewPdfs.length, previewIndex])

  useEffect(() => {
    if (pageIndex >= totalPages && totalPages > 0) {
      setPageIndex(0)
    }
  }, [pageIndex, totalPages])

  useEffect(() => {
    // Al cambiar filtros, volvemos al inicio para que el usuario no “caiga” en una página vacía.
    setPageIndex(0)
    setPreviewIndex(0)
  }, [normalizedAgentSearch, normalizedPeriodSearch])

  const clearFilters = useCallback(() => {
    setAgentSearch('')
    setPeriodSearchDate('')
    setPageIndex(0)
    setPreviewIndex(0)
  }, [])

  const downloadAllPdfs = useCallback(async () => {
    if (!filteredData) return

    try {
      setDownloadError(null)
      setDownloadingZip(true)
      setZipProgress(null)
      setZipSkipped([])
      const docs: PdfEntry[] =
        groupMode === 'agent'
          ? buildAgentPdfs(filteredData, chequesByKey)
          : buildPeriodPdfs(filteredData, chequesByKey)
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
          const zipPath =
            groupMode === 'agent' && 'cuil' in d
              ? // Guardamos PDFs por agente en subcarpetas por CUIL.
                `${d.cuil}/${filename}`
              : filename
          zip.file(zipPath, base64, { base64: true })
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
      const rawZipBlob = await zip.generateAsync({ type: 'blob' })
      // Asegurar MIME para mejorar compatibilidad (algunos browsers descargan mejor con type explícito).
      const zipBlob = new Blob([rawZipBlob], { type: 'application/zip' })
      // Disparar descarga dentro del handler (mejor compatibilidad que hacerlo en useEffect).
      downloadBlob(zipBlob, nextZipName)
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
  }, [filteredData, groupMode, chequesByKey])

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-8 text-gray-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">
              Sistema de Consulta de Haberes Docentes
            </h1>
            <p className="text-sm text-gray-600">
              Podés consultar por lote cargando un CSV (Sercope) o de forma manual por CUIL/DNI y período.
            </p>
          </div>
        </header>

        <Card title="Entrada de datos">
          <div className="grid gap-6 lg:grid-cols-2">
            <CuilUploader
              onParsed={onCsvParsed}
              sources={csvSources.map((s) => ({
                name: s.name,
                documentos: s.documentos.length,
                periodos: s.periodos.length,
              }))}
              onRemoveSource={(index) => dispatch({ type: 'REMOVE_CSV_SOURCE', payload: { index } })}
              disabled={queryMode === 'manual'}
            />

            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">Modo de carga</h4>
                    <p className="text-xs text-gray-600">
                      Elegí cómo querés consultar y generar los PDFs.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={queryMode === 'batch' ? 'primary' : 'secondary'}
                      onClick={() => dispatch({ type: 'SET_QUERY_MODE', payload: 'batch' })}
                    >
                      Lote (CSV)
                    </Button>
                    <Button
                      type="button"
                      variant={queryMode === 'manual' ? 'primary' : 'secondary'}
                      onClick={() => dispatch({ type: 'SET_QUERY_MODE', payload: 'manual' })}
                    >
                      Manual (CUIL + rango)
                    </Button>
                  </div>
                </div>

                {queryMode === 'batch' ? (
                  <div className="space-y-3">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-900 select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-blue-600"
                        checked={batchUseManualPeriods}
                        onChange={(e) =>
                          dispatch({ type: 'SET_BATCH_USE_MANUAL_PERIODS', payload: e.target.checked })
                        }
                      />
                      Seleccionar períodos manualmente
                    </label>
                    {!batchUseManualPeriods ? (
                      <p className="text-xs text-gray-600">
                        Se usan automáticamente los rangos por DNI que vienen en el CSV (Periodo Desde/Hasta).
                      </p>
                    ) : null}
                    {batchUseManualPeriods ? (
                      <PeriodSelector
                        value={periodos}
                        available={availablePeriodos}
                        onChange={(next) => dispatch({ type: 'SET_PERIODOS', payload: next })}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-900">
                        CUIL/DNI (sin guiones)
                      </label>
                      <div className="mt-1">
                        <Input
                          value={manualCuil}
                          inputMode="numeric"
                          pattern="\d*"
                          maxLength={11}
                          onChange={(e) => {
                            const next = e.target.value.replace(/[^\d]/g, '')
                            dispatch({ type: 'SET_MANUAL_CUIL', payload: next })
                          }}
                          placeholder="Ingresá un único CUIL (11) o DNI (8)…"
                        />
                      </div>
                      <p className="mt-1 text-xs text-gray-600">
                        {manualCuil.trim().length === 0 ? (
                          <>Ingresá un único valor (solo números).</>
                        ) : manualIdValid ? (
                          <>CUIL/DNI válido.</>
                        ) : (
                          <>Debe tener 8 (DNI) o 11 (CUIL) dígitos.</>
                        )}
                      </p>
                    </div>

                    <PeriodSelector
                      value={periodos}
                      available={availablePeriodos}
                      onChange={(next) => dispatch({ type: 'SET_PERIODOS', payload: next })}
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => void consult()} disabled={loading}>
                  {loading ? 'Consultando' : 'Consultar'}
                </Button>
                <div className="text-sm text-gray-700">
                  <span className="font-medium">{effectiveDocCount}</span> documentos{' '}
                  <span className="font-medium">{effectivePeriodCount}</span> período(s)
                </div>
              </div>
              {loading && fetchProgress ? (
                <p className="text-xs text-gray-600">
                  {fetchProgress.label}{' '}
                  {fetchProgress.total > 0
                    ? `${fetchProgress.current}/${fetchProgress.total} · ${Math.round(
                        (fetchProgress.current / fetchProgress.total) * 100,
                      )}%`
                    : null}
                </p>
              ) : null}
              {!loading && data && dataStale ? (
                <p className="text-xs text-amber-700">
                  Se cargaron o modificaron CSV después de esta consulta. Los resultados de abajo
                  corresponden a la consulta anterior; presioná &quot;Consultar&quot; para
                  actualizarlos.
                </p>
              ) : null}
              {!loading && chequesErrorCount > 0 ? (
                <p className="text-xs text-amber-700">
                  Cheques: {chequesErrorCount} consulta(s) con error. Reintentá Consultar.
                </p>
              ) : null}

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

              <div className="grid gap-3 md:grid-cols-4">
                <Input
                  value={agentSearch}
                  onChange={(event) => {
                    setAgentSearch(event.target.value)
                  }}
                  placeholder="Buscar por documento/agente…"
                />
                <DatePicker
                  value={periodSearchDate}
                  onChange={(next) => setPeriodSearchDate(next)}
                  aria-label="Buscar por período (seleccionando una fecha)"
                  className="w-full"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={clearFilters}
                  disabled={!agentSearch.trim() && !periodSearchDate.trim()}
                  className="h-8 self-end px-2 text-[11px] leading-none"
                >
                  Limpiar filtros
                </Button>
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
                <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p>
                      Se detectaron {data.errors.length} observaciones al normalizar la respuesta.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-7 px-2 text-[11px] leading-none"
                      onClick={() => setShowErrorDetails((v) => !v)}
                    >
                      {showErrorDetails ? 'Ocultar detalles' : 'Ver detalles'}
                    </Button>
                  </div>
                  {showErrorDetails ? (
                    (() => {
                      const genericMessages = new Set<string>([
                        'No se pudieron obtener pagos en ninguno de los períodos consultados para este documento. Verificá que los datos sean correctos o intentá más tarde.',
                        'No se detectaron pagos para este período. Es posible que todavía no estén acreditados o que haya un problema en el servicio de consulta.',
                      ])
                      const onlyGeneric =
                        data.errors?.length &&
                        data.errors.every((e) => genericMessages.has(e.message))

                      return (
                        <div className="space-y-2 text-xs">
                          <div>
                            <p className="font-semibold">Documentos con observaciones</p>
                            <ul className="mt-1 list-disc pl-5">
                              {Array.from(
                                new Map(
                                  data.errors.map((e) => [
                                    e.cuil,
                                    {
                                      cuil: e.cuil,
                                      messages: data.errors
                                        .filter((x) => x.cuil === e.cuil)
                                        .map((x) => x.message),
                                    },
                                  ]),
                                ).values(),
                              ).map((entry) => (
                                <li key={entry.cuil}>
                                  <span className="font-mono">{entry.cuil}</span>
                                  {entry.messages.length > 0 ? (
                                    <span className="text-gray-700">
                                      {' '}
                                      – {entry.messages[0]}
                                      {entry.messages.length > 1
                                        ? ` (+${entry.messages.length - 1} más)`
                                        : ''}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                          {/* Ocultamos "Detalle completo": solo mostramos el resumen por documento. */}
                        </div>
                      )
                    })()
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => {
                    setPreviewIndex(0)
                    setPdfOpen(true)
                  }}
                  disabled={previewPdfs.length === 0 || (data.items?.length ?? 0) === 0}
                >
                  Vista previa PDF (primer grupo)
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void downloadAllPdfs()}
                  disabled={zipPdfCount === 0 || downloadingZip}
                >
                  {downloadingZip ? 'Generando ZIP…' : 'Descargar PDFs (ZIP)'}
                </Button>
                <span className="text-xs text-gray-600 self-center">
                  {zipPdfCount} PDF(s) en el ZIP
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

              {/* Contenedor scrolleable para evitar que la página crezca demasiado con resultados */}
              <div className="max-h-[60vh] overflow-y-auto pr-1">
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
            </div>
          </Card>
        ) : null}

        {pdfOpen && preview ? (
          <PdfPreviewModal
            doc={preview.doc}
            filename={pdfFilename(preview)}
            metaLabel={`Agente ${preview.cuil} – Período ${preview.periodo}`}
            onClose={() => setPdfOpen(false)}
            onPrev={handlePrevPeriodInAgent}
            onNext={handleNextPeriodInAgent}
            hasPrev={hasPrevPeriodInAgent}
            hasNext={hasNextPeriodInAgent}
            onPrevAgent={handlePrevAgent}
            onNextAgent={handleNextAgent}
            hasPrevAgent={hasPrevAgent}
            hasNextAgent={hasNextAgent}
            onSearch={handlePreviewSearch}
          />
        ) : null}
      </div>
    </div>
  )
}
