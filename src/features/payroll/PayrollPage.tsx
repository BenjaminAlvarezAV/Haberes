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
import { buildAgentPdfs } from '../../pdf/builders'
import type { AgentPeriodPdf } from '../../pdf/builders'
import { createPdfBase64, downloadBlob } from '../../pdf/render'
import { groupByAgent, groupByPeriod } from '../../utils/grouping'
import type { GroupedByAgent, GroupedByPeriod } from '../../utils/grouping'
import { ThemeToggle } from '../../theme/ThemeToggle'

type PdfEntry = AgentPeriodPdf

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
  return `haberes-${pdf.cuil}-${pdf.periodo}.pdf`
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
    availablePeriodos,
    periodos,
    batchUseManualPeriods,
    queryMode,
    manualCuil,
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
    if (queryMode !== 'manual' && normalizedAgentSearch) {
      items = items.filter((it) => it.cuil.toLowerCase().startsWith(normalizedAgentSearch))
    }
    if (normalizedPeriodSearch) {
      items = items.filter((it) => it.periodo.toLowerCase().includes(normalizedPeriodSearch))
    }

    const used = new Set(items.map((it) => it.cuil))
    const agents = data.agents.filter((a) => used.has(a.cuil))

    return { ...data, items, agents }
  }, [data, queryMode, normalizedAgentSearch, normalizedPeriodSearch])

  const grouped = useMemo(() => {
    if (!filteredData) return null
    return groupMode === 'agent' ? groupByAgent(filteredData) : groupByPeriod(filteredData)
  }, [filteredData, groupMode])

  const agentPdfs = useMemo(
    () => (filteredData ? buildAgentPdfs(filteredData, chequesByKey) : []),
    [filteredData, chequesByKey],
  )
  const chequesErrorCount = useMemo(
    () => Object.values(chequesByKey).filter((bundle) => bundle.errors && bundle.errors.length > 0).length,
    [chequesByKey],
  )
  // Vista previa: siempre 1 PDF por (agente × período), igual que al agrupar por agente.
  // Con agrupación o filtro por período, ordenamos período → CUIL para alinear con la tabla y la paginación.
  const previewPdfs = useMemo(() => {
    if (agentPdfs.length === 0) return agentPdfs
    const periodFirst = groupMode === 'period' || Boolean(normalizedPeriodSearch)
    if (!periodFirst) return agentPdfs
    return [...agentPdfs].sort((a, b) => {
      if (a.periodo !== b.periodo) return a.periodo.localeCompare(b.periodo)
      return a.cuil.localeCompare(b.cuil)
    })
  }, [agentPdfs, groupMode, normalizedPeriodSearch])
  const zipPdfCount = agentPdfs.length
  const preview = previewPdfs[previewIndex] ?? null
  const previewAgentOrder = useMemo(
    () => Array.from(new Set(previewPdfs.map((p) => p.cuil))),
    [previewPdfs],
  )
  const previewAgentPositionLabel = useMemo(() => {
    if (!preview) return null
    const idx = previewAgentOrder.findIndex((id) => id === preview.cuil)
    if (idx < 0) return null
    return `${idx + 1}/${previewAgentOrder.length}`
  }, [preview, previewAgentOrder])

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
    for (let i = previewIndex - 1; i >= 0; i -= 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && p.cuil !== preview.cuil) {
        setPreviewIndex(i)
        return
      }
    }
  }, [previewPdfs, preview, previewIndex])

  const handleNextAgent = useCallback(() => {
    if (!preview || !('cuil' in preview)) return
    for (let i = previewIndex + 1; i < previewPdfs.length; i += 1) {
      const p = previewPdfs[i]
      if ('cuil' in p && p.cuil !== preview.cuil) {
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

  const openPdfPreview = useCallback(() => {
    if (previewPdfs.length === 0) {
      setPreviewIndex(0)
      setPdfOpen(true)
      return
    }
    let idx = 0
    if (groupMode === 'period' && currentKey) {
      const i = previewPdfs.findIndex((p) => p.periodo === currentKey)
      idx = i >= 0 ? i : 0
    } else if (groupMode === 'agent' && currentKey) {
      const i = previewPdfs.findIndex((p) => p.cuil === currentKey)
      idx = i >= 0 ? i : 0
    } else if (normalizedPeriodSearch) {
      const i = previewPdfs.findIndex((p) => p.periodo.toLowerCase().includes(normalizedPeriodSearch))
      idx = i >= 0 ? i : 0
    }
    setPreviewIndex(idx)
    setPdfOpen(true)
  }, [previewPdfs, groupMode, currentKey, normalizedPeriodSearch])

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
    const v = manualCuil.trim().toUpperCase()
    return /^\d{11}$/.test(v) || /^[A-Z0-9]{8}$/.test(v)
  }, [manualCuil])

  const effectiveDocCount = queryMode === 'manual' ? (manualIdValid ? 1 : 0) : cuils.length
  // Manual: mismos períodos que elegís en el selector (no usan manualFrom/manualTo del estado; la consulta usa periodos).
  const effectivePeriodCount =
    queryMode === 'manual'
      ? periodos.length
      : batchUseManualPeriods
        ? periodos.length
        : availablePeriodos.length

  useEffect(() => {
    if (queryMode === 'manual' && groupMode === 'agent') {
      dispatch({ type: 'SET_GROUP_MODE', payload: 'period' })
    }
  }, [queryMode, groupMode, dispatch])

  useEffect(() => {
    if (queryMode === 'manual') {
      setAgentSearch('')
    }
  }, [queryMode])

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
  }, [normalizedAgentSearch, normalizedPeriodSearch, queryMode, groupMode])

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
      // Siempre 1 PDF por agente × período; la carpeta del ZIP depende del modo de agrupación.
      const docs: PdfEntry[] = buildAgentPdfs(filteredData, chequesByKey)
      if (docs.length === 0) return

      const manualDocFolder =
        queryMode === 'manual' ? manualCuil.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : ''

      const zip = new JSZip()
      let added = 0
      const skipped: string[] = []
      for (let i = 0; i < docs.length; i += 1) {
        const d = docs[i]
        const filename = pdfFilename(d)
        setZipProgress({ current: i + 1, total: docs.length, label: filename })
        try {
          const base64 = await createPdfBase64WithTimeout(d.doc, PDF_TIMEOUT_MS)
          const inner =
            groupMode === 'agent' ? `${d.cuil}/${filename}` : `${d.periodo}/${filename}`
          const zipPath = manualDocFolder ? `${manualDocFolder}/${inner}` : inner
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

      const nextZipName =
        queryMode === 'manual'
          ? (() => {
              const normalized = manualCuil.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
              return normalized ? `haberes-${normalized}.zip` : 'haberes-manual.zip'
            })()
          : groupMode === 'agent'
            ? 'haberes-por-agente.zip'
            : 'haberes-por-periodo.zip'
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
  }, [filteredData, groupMode, chequesByKey, queryMode, manualCuil])

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-on-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">
              Sistema de Consulta de Haberes Docentes
            </h1>
            <p className="text-sm text-on-surface-variant">
              Podés consultar por lote cargando un CSV (Sercope) o de forma manual por CUIL/DNI y período.
            </p>
          </div>
          <ThemeToggle />
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
                    <h4 className="text-sm font-semibold text-on-surface">Modo de carga</h4>
                    <p className="text-xs text-on-surface-variant">
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
                    <label className="inline-flex items-center gap-2 text-sm text-on-surface select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={batchUseManualPeriods}
                        onChange={(e) =>
                          dispatch({ type: 'SET_BATCH_USE_MANUAL_PERIODS', payload: e.target.checked })
                        }
                      />
                      Seleccionar períodos manualmente
                    </label>
                    {!batchUseManualPeriods ? (
                      <p className="text-xs text-on-surface-variant">
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
                      <label className="block text-sm font-medium text-on-surface">
                        CUIL/DNI (sin guiones)
                      </label>
                      <div className="mt-1">
                        <Input
                          value={manualCuil}
                          inputMode="text"
                          maxLength={11}
                          onChange={(e) => {
                            const next = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
                            dispatch({ type: 'SET_MANUAL_CUIL', payload: next })
                          }}
                          placeholder="Ingresá un único CUIL (11) o DNI (8, alfanumérico)…"
                        />
                      </div>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {manualCuil.trim().length === 0 ? (
                          <>Ingresá un único valor (solo letras y números).</>
                        ) : manualIdValid ? (
                          <>CUIL/DNI válido.</>
                        ) : (
                          <>Debe tener 8 caracteres alfanuméricos (DNI) o 11 dígitos (CUIL).</>
                        )}
                      </p>
                    </div>

                    <PeriodSelector
                      value={periodos}
                      available={[]}
                      onChange={(next) => dispatch({ type: 'SET_PERIODOS', payload: next })}
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => void consult()} disabled={loading}>
                  {loading ? 'Consultando' : 'Consultar'}
                </Button>
                <div className="text-sm text-on-surface-variant">
                  <span className="font-medium">{effectiveDocCount}</span> documentos{' '}
                  <span className="font-medium">{effectivePeriodCount}</span> período(s)
                </div>
              </div>
              {loading && fetchProgress ? (
                <p className="text-xs text-on-surface-variant">
                  {fetchProgress.label}{' '}
                  {fetchProgress.total > 0
                    ? `${fetchProgress.current}/${fetchProgress.total} · ${Math.round(
                        (fetchProgress.current / fetchProgress.total) * 100,
                      )}%`
                    : null}
                </p>
              ) : null}
              {!loading && data && dataStale ? (
                <p className="text-xs text-warning-text">
                  Se cargaron o modificaron CSV después de esta consulta. Los resultados de abajo
                  corresponden a la consulta anterior; presioná &quot;Consultar&quot; para
                  actualizarlos.
                </p>
              ) : null}
              {!loading && chequesErrorCount > 0 ? (
                <p className="text-xs text-warning-text">
                  Cheques: {chequesErrorCount} consulta(s) con error. Reintentá Consultar.
                </p>
              ) : null}

              {lastUploadReport ? (
                <p className="text-xs text-on-surface-variant">
                  Último CSV: {lastUploadReport.valid} válidos, {lastUploadReport.invalid} inválidos,{' '}
                  {lastUploadReport.duplicates} duplicados.
                </p>
              ) : null}

              {error ? (
                <div className="rounded-md bg-danger-bg p-3 text-sm text-danger-text ring-1 ring-danger-border">
                  {error.message}
                </div>
              ) : null}
            </div>
          </div>
        </Card>

        {data ? (
          <Card>
            <div className="space-y-4">
              {queryMode === 'batch' ? (
                <GroupToggle
                  value={groupMode}
                  onChange={(mode) => dispatch({ type: 'SET_GROUP_MODE', payload: mode })}
                />
              ) : (
                <div>
                  <h3 className="text-sm font-semibold text-on-surface">Resultados</h3>
                  <p className="text-xs text-on-surface-variant">Agrupados por período (un solo agente en consulta manual).</p>
                </div>
              )}

              <div
                className={
                  queryMode === 'manual' ? 'grid gap-3 md:grid-cols-3' : 'grid gap-3 md:grid-cols-4'
                }
              >
                {queryMode === 'batch' ? (
                  <Input
                    value={agentSearch}
                    onChange={(event) => {
                      setAgentSearch(event.target.value)
                    }}
                    placeholder="Buscar por documento/agente…"
                  />
                ) : null}
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
                  disabled={
                    queryMode === 'manual'
                      ? !periodSearchDate.trim()
                      : !agentSearch.trim() && !periodSearchDate.trim()
                  }
                  className="h-8 self-end px-2 text-[11px] leading-none"
                >
                  Limpiar filtros
                </Button>
                <div className="flex items-center gap-2 text-xs text-on-surface-variant">
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
                <div className="rounded-md bg-warning-bg p-3 text-sm text-warning-text ring-1 ring-warning-border space-y-2">
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
                      const errs = data.errors ?? []
                      return (
                        <div className="space-y-2 text-xs">
                          <div>
                            <p className="font-semibold">Documentos con observaciones</p>
                            <ul className="mt-1 list-disc pl-5">
                              {Array.from(
                                new Map(
                                  errs.map((e) => [
                                    e.cuil,
                                    {
                                      cuil: e.cuil,
                                      messages: errs.filter((x) => x.cuil === e.cuil).map((x) => x.message),
                                    },
                                  ]),
                                ).values(),
                              ).map((entry) => (
                                <li key={entry.cuil}>
                                  <span className="font-mono">{entry.cuil}</span>
                                  {entry.messages.length > 0 ? (
                                    <span className="text-on-surface-variant">
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
                  onClick={openPdfPreview}
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
                <span className="text-xs text-on-surface-variant self-center">
                  {zipPdfCount} PDF(s) en el ZIP
                </span>
              </div>
              {zipProgress ? (
                <p className="text-xs text-on-surface-variant">
                  Generando ZIP: {zipProgress.current}/{zipProgress.total} — {zipProgress.label}
                </p>
              ) : null}
              {downloadError ? (
                <p className="text-xs text-danger-text">{downloadError}</p>
              ) : null}
              {zipSkipped.length > 0 ? (
                <p className="text-xs text-warning-text">
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
                        <h4 className="text-sm font-semibold text-on-surface">Agente {currentKey}</h4>
                        <span className="text-xs text-on-surface-variant">{grouped.byCuil[currentKey].length} ítems</span>
                      </div>
                      <ResultsTable items={grouped.byCuil[currentKey]} />
                    </div>
                  </div>
                ) : null}

                {groupMode === 'period' && isGroupedByPeriod(grouped) && currentKey ? (
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-on-surface">Período {currentKey}</h4>
                        <span className="text-xs text-on-surface-variant">{grouped.byPeriod[currentKey].length} ítems</span>
                      </div>
                      <ResultsTable items={grouped.byPeriod[currentKey]} separatorBy="agent" />
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
            metaLabel={`Documento/Agente ${preview.cuil} – Período ${preview.periodo}`}
            agentPositionLabel={previewAgentPositionLabel ?? undefined}
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
