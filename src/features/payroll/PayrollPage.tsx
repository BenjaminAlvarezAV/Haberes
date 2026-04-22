import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { createPdfUint8Array, downloadBlob } from '../../pdf/render'
import { fetchChequesBundle } from '../../services/chequesService'
import { groupByAgent, groupByPeriod } from '../../utils/grouping'
import type { GroupedByAgent, GroupedByPeriod } from '../../utils/grouping'
import { mapLimit } from '../../utils/promise'
import {
  filterChequesBundleBySecuencia,
  resolveCsvSecuenciaFilterSpecForPair,
} from '../../utils/chequesSecuenciaFilter'
import { ThemeToggle } from '../../theme/ThemeToggle'
import type { ChequesBundle } from '../../types/cheques'
import type { PayrollItem } from '../../types/payroll'

type PdfEntry = AgentPeriodPdf
type PdfTarget = { cuil: string; periodo: string }

function isGroupedByAgent(grouped: GroupedByAgent | GroupedByPeriod | null): grouped is GroupedByAgent {
  return Boolean(grouped && 'orderedCuils' in grouped)
}

function isGroupedByPeriod(grouped: GroupedByAgent | GroupedByPeriod | null): grouped is GroupedByPeriod {
  return Boolean(grouped && 'orderedPeriods' in grouped)
}

function pdfFilename(pdf: PdfEntry): string {
  return `haberes-${pdf.cuil}-${pdf.periodo}.pdf`
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function bundleToPayrollItems(bundle: ChequesBundle, visibleCuil: string): PayrollItem[] {
  const periodo = `${bundle.periodoYYYYMM.slice(0, 4)}-${bundle.periodoYYYYMM.slice(4, 6)}`
  const items: PayrollItem[] = []
  let hasNonZeroDetail = false

  bundle.liquidacionPorSecuencia.forEach((row) => {
    if (row.pesos === null || Number.isNaN(row.pesos)) return
    if (row.pesos !== 0) hasNonZeroDetail = true
    items.push({
      cuil: visibleCuil,
      periodo,
      concepto: row.descripcionCodigo ?? 'Sin concepto',
      importe: row.pesos,
    })
  })

  const totalLiquido = bundle.liquidPorEstablecimiento.reduce((acc, row) => acc + (row.liquido ?? 0), 0)
  if (!Number.isNaN(totalLiquido) && (hasNonZeroDetail || totalLiquido !== 0)) {
    items.push({
      cuil: visibleCuil,
      periodo,
      concepto: 'Total líquido por establecimiento',
      importe: totalLiquido,
    })
  }

  return items
}

function bundleToObservations(bundle: ChequesBundle, visibleCuil: string): Array<{ cuil: string; message: string }> {
  const periodo = `${bundle.periodoYYYYMM.slice(0, 4)}-${bundle.periodoYYYYMM.slice(4, 6)}`
  const observations: Array<{ cuil: string; message: string }> = []
  let hasNonZeroDetail = false

  bundle.liquidacionPorSecuencia.forEach((row) => {
    if (row.pesos === null || Number.isNaN(row.pesos)) {
      observations.push({
        cuil: visibleCuil,
        message: `Importe inválido para código ${row.codigo ?? ''} en período ${periodo}.`,
      })
      return
    }
    if (row.pesos !== 0) hasNonZeroDetail = true
  })

  const totalLiquido = bundle.liquidPorEstablecimiento.reduce((acc, row) => acc + (row.liquido ?? 0), 0)
  if (!hasNonZeroDetail && totalLiquido === 0) {
    observations.push({
      cuil: visibleCuil,
      message: `No se detectaron pagos para el período ${periodo}.`,
    })
  }

  if (bundle.errors && bundle.errors.length > 0) {
    observations.push(
      ...bundle.errors.map((msg) => ({
        cuil: visibleCuil,
        message: msg,
      })),
    )
  }

  return observations
}

const PDF_TIMEOUT_MS = 60000
const ON_DEMAND_PDF_THRESHOLD = 100
const ZIP_DOWNLOAD_CONCURRENCY = 4
const TARGET_FETCH_KEY_SEP = '|'

async function createPdfUint8ArrayWithTimeout(doc: PdfEntry['doc'], ms: number): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    createPdfUint8Array(doc)
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
  const [onDemandPreview, setOnDemandPreview] = useState<PdfEntry | null>(null)
  const [onDemandPreviewLoading, setOnDemandPreviewLoading] = useState(false)
  const [previewLoadError, setPreviewLoadError] = useState<string | null>(null)
  const [tableOnDemandItems, setTableOnDemandItems] = useState<PayrollItem[]>([])
  const [tableOnDemandLoading, setTableOnDemandLoading] = useState(false)
  const [tableOnDemandError, setTableOnDemandError] = useState<string | null>(null)
  const [tableOnDemandItemsByGroup, setTableOnDemandItemsByGroup] = useState<Record<string, PayrollItem[]>>({})
  const [onDemandObservations, setOnDemandObservations] = useState<Array<{ cuil: string; message: string }>>([])
  const seenOnDemandObservationKeysRef = useRef(new Set<string>())
  const [consultStartedAt, setConsultStartedAt] = useState<number | null>(null)
  const [consultElapsedMs, setConsultElapsedMs] = useState(0)
  const [lastConsultDurationMs, setLastConsultDurationMs] = useState<number | null>(null)
  const [zipStartedAt, setZipStartedAt] = useState<number | null>(null)
  const [zipElapsedMs, setZipElapsedMs] = useState(0)
  const [lastZipDurationMs, setLastZipDurationMs] = useState<number | null>(null)
  const bundleCacheRef = useRef(new Map<string, ChequesBundle>())
  const bundleInFlightRef = useRef(new Map<string, Promise<ChequesBundle | null>>())
  const pdfCacheRef = useRef(new Map<string, PdfEntry | null>())
  const pdfInFlightRef = useRef(new Map<string, Promise<PdfEntry | null>>())

  const clearHeavyCaches = useCallback(() => {
    bundleCacheRef.current.clear()
    bundleInFlightRef.current.clear()
    pdfCacheRef.current.clear()
    pdfInFlightRef.current.clear()
  }, [])

  const cleanupAfterDownload = useCallback(() => {
    clearHeavyCaches()
    setOnDemandPreview(null)
    setPreviewLoadError(null)
    setTableOnDemandItems([])
    setTableOnDemandItemsByGroup({})
    setTableOnDemandLoading(false)
    setTableOnDemandError(null)
    setOnDemandObservations([])
    seenOnDemandObservationKeysRef.current.clear()
    setZipProgress(null)
  }, [clearHeavyCaches])

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

  const pdfTargets = useMemo<PdfTarget[]>(() => {
    if (!filteredData) return []
    const set = new Set<string>()
    for (const it of filteredData.items) set.add(`${it.cuil}|${it.periodo}`)
    return Array.from(set)
      .map((raw) => {
        const [cuil, periodo] = raw.split('|')
        return { cuil, periodo }
      })
      .sort((a, b) => {
        if (a.periodo !== b.periodo) return a.periodo.localeCompare(b.periodo)
        return a.cuil.localeCompare(b.cuil)
      })
  }, [filteredData])
  const onDemandPdfMode = pdfTargets.length > ON_DEMAND_PDF_THRESHOLD
  const agentPdfs = useMemo(
    () => (filteredData && !onDemandPdfMode ? buildAgentPdfs(filteredData, chequesByKey) : []),
    [filteredData, chequesByKey, onDemandPdfMode],
  )
  const chequesErrorCount = useMemo(
    () => Object.values(chequesByKey).filter((bundle) => bundle.errors && bundle.errors.length > 0).length,
    [chequesByKey],
  )
  // Vista previa: siempre 1 PDF por (agente × período), igual que al agrupar por agente.
  // Con agrupación o filtro por período, ordenamos período → CUIL para alinear con la tabla y la paginación.
  const eagerPreviewPdfs = useMemo(() => {
    if (agentPdfs.length === 0) return agentPdfs
    const periodFirst = groupMode === 'period' || Boolean(normalizedPeriodSearch)
    if (!periodFirst) return agentPdfs
    return [...agentPdfs].sort((a, b) => {
      if (a.periodo !== b.periodo) return a.periodo.localeCompare(b.periodo)
      return a.cuil.localeCompare(b.cuil)
    })
  }, [agentPdfs, groupMode, normalizedPeriodSearch])
  const previewTargets = useMemo(() => {
    if (onDemandPdfMode) return pdfTargets
    return eagerPreviewPdfs.map((p) => ({ cuil: p.cuil, periodo: p.periodo }))
  }, [onDemandPdfMode, pdfTargets, eagerPreviewPdfs])
  const zipPdfCount = previewTargets.length
  const preview = onDemandPdfMode ? onDemandPreview : (eagerPreviewPdfs[previewIndex] ?? null)
  const previewAgentOrder = useMemo(
    () => Array.from(new Set(previewTargets.map((p) => p.cuil))),
    [previewTargets],
  )
  const previewAgentPositionLabel = useMemo(() => {
    if (!preview) return null
    const idx = previewAgentOrder.findIndex((id) => id === preview.cuil)
    if (idx < 0) return null
    return `${idx + 1}/${previewAgentOrder.length}`
  }, [preview, previewAgentOrder])
  const previewPeriodOrder = useMemo(
    () => Array.from(new Set(previewTargets.map((p) => p.periodo))),
    [previewTargets],
  )
  const visibleErrors = useMemo(() => {
    const base = data?.errors ?? []
    if (!onDemandPdfMode || onDemandObservations.length === 0) return base
    const merged = [...base]
    const seen = new Set(base.map((e) => `${e.cuil}|${e.message}`))
    onDemandObservations.forEach((e) => {
      const key = `${e.cuil}|${e.message}`
      if (seen.has(key)) return
      seen.add(key)
      merged.push(e)
    })
    return merged
  }, [data, onDemandPdfMode, onDemandObservations])

  const hasPrevPeriodInAgent = useMemo(() => {
    if (!preview) return false
    for (let i = previewIndex - 1; i >= 0; i -= 1) {
      const p = previewTargets[i]
      if (p.cuil === preview.cuil && p.periodo !== preview.periodo) return true
    }
    return false
  }, [previewTargets, preview, previewIndex])

  const hasNextPeriodInAgent = useMemo(() => {
    if (!preview) return false
    for (let i = previewIndex + 1; i < previewTargets.length; i += 1) {
      const p = previewTargets[i]
      if (p.cuil === preview.cuil && p.periodo !== preview.periodo) return true
    }
    return false
  }, [previewTargets, preview, previewIndex])

  const handlePrevPeriodInAgent = useCallback(async () => {
    if (!preview) return
    for (let i = previewIndex - 1; i >= 0; i -= 1) {
      const p = previewTargets[i]
      if (p.cuil === preview.cuil && p.periodo !== preview.periodo) {
        if (onDemandPdfMode) {
          const ok = await loadOnDemandPreviewByIndex(i)
          if (!ok) return
        }
        setPreviewIndex(i)
        return
      }
    }
  }, [previewTargets, preview, previewIndex, onDemandPdfMode, loadOnDemandPreviewByIndex])

  const handleNextPeriodInAgent = useCallback(async () => {
    if (!preview) return
    for (let i = previewIndex + 1; i < previewTargets.length; i += 1) {
      const p = previewTargets[i]
      if (p.cuil === preview.cuil && p.periodo !== preview.periodo) {
        if (onDemandPdfMode) {
          const ok = await loadOnDemandPreviewByIndex(i)
          if (!ok) return
        }
        setPreviewIndex(i)
        return
      }
    }
  }, [previewTargets, preview, previewIndex, onDemandPdfMode, loadOnDemandPreviewByIndex])

  const hasPrevAgent = useMemo(() => {
    if (!preview) return false
    for (let i = previewIndex - 1; i >= 0; i -= 1) {
      const p = previewTargets[i]
      if (p.cuil !== preview.cuil) return true
    }
    return false
  }, [previewTargets, preview, previewIndex])

  const hasNextAgent = useMemo(() => {
    if (!preview) return false
    for (let i = previewIndex + 1; i < previewTargets.length; i += 1) {
      const p = previewTargets[i]
      if (p.cuil !== preview.cuil) return true
    }
    return false
  }, [previewTargets, preview, previewIndex])

  const handlePrevAgent = useCallback(async () => {
    if (!preview) return
    for (let i = previewIndex - 1; i >= 0; i -= 1) {
      const p = previewTargets[i]
      if (p.cuil !== preview.cuil) {
        if (onDemandPdfMode) {
          const ok = await loadOnDemandPreviewByIndex(i)
          if (!ok) return
        }
        setPreviewIndex(i)
        return
      }
    }
  }, [previewTargets, preview, previewIndex, onDemandPdfMode, loadOnDemandPreviewByIndex])

  const handleNextAgent = useCallback(async () => {
    if (!preview) return
    for (let i = previewIndex + 1; i < previewTargets.length; i += 1) {
      const p = previewTargets[i]
      if (p.cuil !== preview.cuil) {
        if (onDemandPdfMode) {
          const ok = await loadOnDemandPreviewByIndex(i)
          if (!ok) return
        }
        setPreviewIndex(i)
        return
      }
    }
  }, [previewTargets, preview, previewIndex, onDemandPdfMode, loadOnDemandPreviewByIndex])

  const handlePreviewSearch = useCallback(
    async (query: string) => {
      const q = query.trim().toLowerCase()
      if (!q) return

      let targetIndex = previewTargets.findIndex(
        (p) => p.cuil.toLowerCase().startsWith(q) || p.periodo.toLowerCase().startsWith(q),
      )
      if (targetIndex === -1) {
        targetIndex = previewTargets.findIndex((p) => p.periodo.toLowerCase().includes(q))
      }
      if (targetIndex !== -1) {
        if (onDemandPdfMode) {
          const ok = await loadOnDemandPreviewByIndex(targetIndex)
          if (!ok) return
        }
        setPreviewIndex(targetIndex)
      }
    },
    [previewTargets, onDemandPdfMode, loadOnDemandPreviewByIndex],
  )

  const keys = useMemo(() => {
    if (groupMode === 'agent') return isGroupedByAgent(grouped) ? grouped.orderedCuils : []
    return isGroupedByPeriod(grouped) ? grouped.orderedPeriods : []
  }, [groupMode, grouped])

  const totalPages = keys.length
  const currentKey = keys[pageIndex] ?? null
  const csvRows = useMemo(() => csvSources.flatMap((s) => s.rows), [csvSources])

  const normalizeRequestedId = useCallback((raw: string): string | null => {
    const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    if (!cleaned) return null
    if (/^\d{11}$/.test(cleaned)) return cleaned.slice(2, 10)
    if (/^[A-Z0-9]{8}$/.test(cleaned)) return cleaned
    return null
  }, [])

  const fetchVisibleBundleForTarget = useCallback(
    async (target: PdfTarget): Promise<ChequesBundle | null> => {
      const targetKey = `${target.cuil}${TARGET_FETCH_KEY_SEP}${target.periodo}`
      const cached = bundleCacheRef.current.get(targetKey)
      if (cached) return cached
      const inFlight = bundleInFlightRef.current.get(targetKey)
      if (inFlight) return inFlight

      const periodoYYYYMM = target.periodo.replace('-', '')
      const apiId = normalizeRequestedId(target.cuil)
      if (!apiId) return null

      const run = (async () => {
        const rawBundle = await fetchChequesBundle(apiId, periodoYYYYMM)
        const secuenciaSpec =
          queryMode === 'batch'
            ? resolveCsvSecuenciaFilterSpecForPair(apiId, periodoYYYYMM, csvRows, normalizeRequestedId)
            : { mode: 'all' as const }
        const filteredBundle = filterChequesBundleBySecuencia(rawBundle, secuenciaSpec)
        const visibleBundle =
          filteredBundle.id === target.cuil ? filteredBundle : { ...filteredBundle, id: target.cuil }
        const observations = bundleToObservations(visibleBundle, target.cuil)
        if (observations.length > 0) {
          setOnDemandObservations((prev) => {
            const next = [...prev]
            observations.forEach((entry) => {
              const key = `${target.cuil}|${visibleBundle.periodoYYYYMM}|${entry.message}`
              if (seenOnDemandObservationKeysRef.current.has(key)) return
              seenOnDemandObservationKeysRef.current.add(key)
              next.push(entry)
            })
            return next
          })
        }
        bundleCacheRef.current.set(targetKey, visibleBundle)
        return visibleBundle
      })()

      bundleInFlightRef.current.set(targetKey, run)
      try {
        return await run
      } finally {
        bundleInFlightRef.current.delete(targetKey)
      }
    },
    [normalizeRequestedId, queryMode, csvRows],
  )

  const buildPdfEntryForTarget = useCallback(
    async (target: PdfTarget): Promise<PdfEntry | null> => {
      if (!filteredData) return null
      const targetKey = `${target.cuil}${TARGET_FETCH_KEY_SEP}${target.periodo}`
      if (pdfCacheRef.current.has(targetKey)) {
        return pdfCacheRef.current.get(targetKey) ?? null
      }
      const inFlight = pdfInFlightRef.current.get(targetKey)
      if (inFlight) return inFlight

      const run = (async () => {
        const visibleBundle = await fetchVisibleBundleForTarget(target)
        if (!visibleBundle) {
          pdfCacheRef.current.set(targetKey, null)
          return null
        }
        const key = `${target.cuil}-${target.periodo.replace('-', '')}`
        const docs = buildAgentPdfs(filteredData, { [key]: visibleBundle }, [target.cuil], [target.periodo])
        const result = docs[0] ?? null
        pdfCacheRef.current.set(targetKey, result)
        return result
      })()

      pdfInFlightRef.current.set(targetKey, run)
      try {
        return await run
      } finally {
        pdfInFlightRef.current.delete(targetKey)
      }
    },
    [filteredData, fetchVisibleBundleForTarget],
  )

  const currentTableTargets = useMemo(() => {
    if (!currentKey) return []
    if (groupMode === 'agent') return previewTargets.filter((p) => p.cuil === currentKey)
    return previewTargets.filter((p) => p.periodo === currentKey)
  }, [previewTargets, groupMode, currentKey])
  const currentTableGroupKey = useMemo(
    () => (currentKey ? `${groupMode}:${currentKey}` : null),
    [groupMode, currentKey],
  )

  async function loadOnDemandPreviewByIndex(idx: number): Promise<boolean> {
    if (!onDemandPdfMode) return true
    const target = previewTargets[idx]
    if (!target) return false

    try {
      setPreviewLoadError(null)
      setOnDemandPreviewLoading(true)
      const next = await buildPdfEntryForTarget(target)
      if (!next) {
        setPreviewLoadError('No se pudo generar la vista previa para el documento/período elegido.')
        return false
      }
      setOnDemandPreview(next)
      return true
    } catch (e) {
      setPreviewLoadError(e instanceof Error ? e.message : 'Error al consultar endpoints para vista previa.')
      return false
    } finally {
      setOnDemandPreviewLoading(false)
    }
  }

  async function queryPreviewByIndex(idx: number): Promise<boolean> {
    const target = previewTargets[idx]
    if (!target) return false
    try {
      setPreviewLoadError(null)
      setOnDemandPreviewLoading(true)
      await buildPdfEntryForTarget(target)
      return true
    } catch (e) {
      setPreviewLoadError(e instanceof Error ? e.message : 'Error al consultar endpoints para vista previa.')
      return false
    } finally {
      setOnDemandPreviewLoading(false)
    }
  }

  const openPdfPreview = useCallback(async () => {
    if (previewTargets.length === 0) {
      setPreviewIndex(0)
      setOnDemandPreview(null)
      setPreviewLoadError(null)
      if (!onDemandPdfMode) setPdfOpen(true)
      return
    }
    let idx = 0
    if (groupMode === 'period' && currentKey) {
      const i = previewTargets.findIndex((p) => p.periodo === currentKey)
      idx = i >= 0 ? i : 0
    } else if (groupMode === 'agent' && currentKey) {
      const i = previewTargets.findIndex((p) => p.cuil === currentKey)
      idx = i >= 0 ? i : 0
    } else if (normalizedPeriodSearch) {
      const i = previewTargets.findIndex((p) => p.periodo.toLowerCase().includes(normalizedPeriodSearch))
      idx = i >= 0 ? i : 0
    }
    if (onDemandPdfMode) {
      const ok = await loadOnDemandPreviewByIndex(idx)
      if (!ok) return
    }
    setPreviewIndex(idx)
    setPdfOpen(true)
  }, [
    previewTargets,
    groupMode,
    currentKey,
    normalizedPeriodSearch,
    onDemandPdfMode,
    loadOnDemandPreviewByIndex,
  ])

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
    if (loading) {
      setConsultStartedAt((prev) => prev ?? Date.now())
      return
    }
    if (consultStartedAt !== null) {
      const duration = Date.now() - consultStartedAt
      setConsultElapsedMs(duration)
      setLastConsultDurationMs(duration)
      setConsultStartedAt(null)
    }
  }, [loading, consultStartedAt])

  useEffect(() => {
    if (!loading || consultStartedAt === null) return
    const tick = () => setConsultElapsedMs(Date.now() - consultStartedAt)
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [loading, consultStartedAt])

  useEffect(() => {
    if (downloadingZip) {
      setZipStartedAt((prev) => prev ?? Date.now())
      return
    }
    if (zipStartedAt !== null) {
      const duration = Date.now() - zipStartedAt
      setZipElapsedMs(duration)
      setLastZipDurationMs(duration)
      setZipStartedAt(null)
    }
  }, [downloadingZip, zipStartedAt])

  useEffect(() => {
    if (!downloadingZip || zipStartedAt === null) return
    const tick = () => setZipElapsedMs(Date.now() - zipStartedAt)
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [downloadingZip, zipStartedAt])

  useEffect(() => {
    if (queryMode === 'manual') {
      setAgentSearch('')
    }
  }, [queryMode])

  useEffect(() => {
    if (loading) {
      setOnDemandObservations([])
      seenOnDemandObservationKeysRef.current.clear()
      clearHeavyCaches()
      setTableOnDemandItemsByGroup({})
    }
  }, [loading, clearHeavyCaches])

  useEffect(() => {
    if (onDemandPdfMode) return
    setOnDemandObservations([])
    seenOnDemandObservationKeysRef.current.clear()
  }, [onDemandPdfMode])

  useEffect(() => {
    if (!onDemandPdfMode) return
    if (Object.keys(chequesByKey).length === 0) return
    dispatch({ type: 'SET_CHEQUES_MAP', payload: {} })
  }, [onDemandPdfMode, chequesByKey, dispatch])

  useEffect(() => {
    if (previewIndex >= previewTargets.length && previewTargets.length > 0) {
      setPreviewIndex(0)
    }
  }, [previewTargets.length, previewIndex])

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

  useEffect(() => {
    setTableOnDemandItemsByGroup({})
  }, [previewTargets, queryMode, groupMode, normalizedAgentSearch, normalizedPeriodSearch])

  useEffect(() => {
    if (!onDemandPdfMode) {
      setTableOnDemandItems([])
      setTableOnDemandLoading(false)
      setTableOnDemandError(null)
      setTableOnDemandItemsByGroup({})
      return
    }
    if (downloadingZip) {
      setTableOnDemandLoading(false)
      return
    }
    if (!currentKey || !currentTableGroupKey || currentTableTargets.length === 0) {
      setTableOnDemandItems([])
      setTableOnDemandLoading(false)
      setTableOnDemandError(null)
      return
    }

    const cached = tableOnDemandItemsByGroup[currentTableGroupKey]
    if (cached) {
      setTableOnDemandItems(cached)
      setTableOnDemandLoading(false)
      setTableOnDemandError(null)
      return
    }

    let cancelled = false
    setTableOnDemandLoading(true)
    setTableOnDemandError(null)
    setTableOnDemandItems([])
    void (async () => {
      try {
        const itemChunks = await mapLimit(currentTableTargets, 4, async (target) => {
          const bundle = await fetchVisibleBundleForTarget(target)
          if (!bundle) return []
          const nextItems = bundleToPayrollItems(bundle, target.cuil)
          if (!cancelled && nextItems.length > 0) {
            setTableOnDemandItems((prev) => [...prev, ...nextItems])
          }
          return nextItems
        })
        if (cancelled) return
        const flat = itemChunks.flat()
        setTableOnDemandItems(flat)
        setTableOnDemandItemsByGroup((prev) => ({ ...prev, [currentTableGroupKey]: flat }))
      } catch (e) {
        if (cancelled) return
        setTableOnDemandItems([])
        setTableOnDemandError(
          e instanceof Error ? e.message : 'No se pudieron consultar los datos del grupo actual.',
        )
      } finally {
        if (!cancelled) setTableOnDemandLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    onDemandPdfMode,
    currentKey,
    currentTableGroupKey,
    currentTableTargets,
    fetchVisibleBundleForTarget,
    downloadingZip,
    tableOnDemandItemsByGroup,
  ])

  const clearFilters = useCallback(() => {
    setAgentSearch('')
    setPeriodSearchDate('')
    setPageIndex(0)
    setPreviewIndex(0)
  }, [])

  const handleSelectPreviewAgent = useCallback(
    async (cuil: string) => {
      if (!cuil) return
      const preferredPeriod = preview?.periodo
      let idx =
        preferredPeriod !== undefined
          ? previewTargets.findIndex((p) => p.cuil === cuil && p.periodo === preferredPeriod)
          : -1
      if (idx < 0) idx = previewTargets.findIndex((p) => p.cuil === cuil)
      if (idx < 0) return
      const ok = onDemandPdfMode ? await loadOnDemandPreviewByIndex(idx) : await queryPreviewByIndex(idx)
      if (!ok) return
      setPreviewIndex(idx)
    },
    [preview, previewTargets, onDemandPdfMode, loadOnDemandPreviewByIndex, queryPreviewByIndex],
  )

  const handleSelectPreviewPeriod = useCallback(
    async (periodo: string) => {
      if (!periodo) return
      const preferredCuil = preview?.cuil
      let idx =
        preferredCuil !== undefined
          ? previewTargets.findIndex((p) => p.periodo === periodo && p.cuil === preferredCuil)
          : -1
      if (idx < 0) idx = previewTargets.findIndex((p) => p.periodo === periodo)
      if (idx < 0) return
      const ok = onDemandPdfMode ? await loadOnDemandPreviewByIndex(idx) : await queryPreviewByIndex(idx)
      if (!ok) return
      setPreviewIndex(idx)
    },
    [preview, previewTargets, onDemandPdfMode, loadOnDemandPreviewByIndex, queryPreviewByIndex],
  )

  const downloadAllPdfs = useCallback(async () => {
    if (!filteredData) return

    try {
      setDownloadError(null)
      setDownloadingZip(true)
      setZipProgress(null)
      setZipSkipped([])
      // Evita arrastrar memoria de una corrida previa al iniciar otra descarga masiva.
      clearHeavyCaches()
      // Siempre 1 PDF por agente × período.
      const docs: PdfEntry[] = onDemandPdfMode
        ? []
        : buildAgentPdfs(filteredData, chequesByKey)
      const targets: PdfTarget[] = onDemandPdfMode
        ? previewTargets
        : docs.map((d) => ({ cuil: d.cuil, periodo: d.periodo }))
      if (targets.length === 0) return

      const manualDocFolder =
        queryMode === 'manual' ? manualCuil.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : ''
      const baseZipName =
        queryMode === 'manual'
          ? (() => {
              const normalized = manualCuil.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
              return normalized ? `haberes-${normalized}` : 'haberes-manual'
            })()
          : groupMode === 'agent'
            ? 'haberes-por-agente'
            : 'haberes-por-periodo'
      const zip = new JSZip()
      const zipConcurrency = Math.min(
        8,
        Math.max(2, Math.floor((((window.navigator?.hardwareConcurrency as number | undefined) ?? 4) + 1) / 2)),
      )
      let completed = 0
      let added = 0
      const skipped: string[] = []

      await mapLimit(targets, zipConcurrency || ZIP_DOWNLOAD_CONCURRENCY, async (target, index) => {
        const fallbackName = `haberes-${target.cuil}-${target.periodo}.pdf`
        try {
          const d = onDemandPdfMode ? await buildPdfEntryForTarget(target) : docs[index]
          if (!d) {
            skipped.push(`${fallbackName} (sin datos)`)
            return null
          }
          const filename = pdfFilename(d)
          const bytes = await createPdfUint8ArrayWithTimeout(d.doc, PDF_TIMEOUT_MS)
          const inner = `${d.cuil}/${filename}`
          const zipPath = manualDocFolder ? `${manualDocFolder}/${inner}` : inner
          zip.file(zipPath, bytes, { binary: true })
          added += 1
          return null
        } catch (err) {
          console.error('Error al generar PDF para ZIP', fallbackName, err)
          const reason =
            err instanceof Error ? (err.message === 'timeout' ? 'timeout' : err.message) : 'error'
          skipped.push(`${fallbackName} (${reason})`)
          return null
        } finally {
          completed += 1
          setZipProgress({
            current: completed,
            total: targets.length,
            label: `Procesados ${completed}/${targets.length}`,
          })
        }
      })

      if (added === 0) {
        setZipSkipped(skipped)
        setDownloadError('No se pudo generar ningún PDF para el ZIP.')
        return
      }

      setZipProgress({
        current: targets.length,
        total: targets.length,
        label: 'Empaquetando ZIP final…',
      })
      let lastPackedPct = -1
      const rawZipBlob = await zip.generateAsync(
        {
          type: 'blob',
          compression: 'STORE',
          streamFiles: true,
        },
        (metadata) => {
          const pct = Math.round(metadata.percent)
          if (pct < 100 && pct - lastPackedPct < 5) return
          lastPackedPct = pct
          setZipProgress({
            current: targets.length,
            total: targets.length,
            label: `Empaquetando ZIP final… ${pct}%`,
          })
        },
      )
      downloadBlob(rawZipBlob, `${baseZipName}.zip`)
      setZipSkipped(skipped)
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
      // Luego de descargar, liberamos estado/caches transitorios para minimizar degradación.
      cleanupAfterDownload()
    }
  }, [
    filteredData,
    chequesByKey,
    queryMode,
    manualCuil,
    onDemandPdfMode,
    previewTargets,
    buildPdfEntryForTarget,
    clearHeavyCaches,
    cleanupAfterDownload,
  ])

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
                        available={[]}
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
                <Button type="button" onClick={() => void consult()} disabled={loading || downloadingZip}>
                  {loading ? 'Consultando' : 'Consultar'}
                </Button>
                <div className="text-sm text-on-surface-variant">
                  <span className="font-medium">{effectiveDocCount}</span> documentos{' '}
                  <span className="font-medium">{effectivePeriodCount}</span> período(s)
                </div>
                {loading ? (
                  <div className="text-xs text-on-surface-variant">
                    Tiempo consulta: <span className="font-medium">{formatElapsed(consultElapsedMs)}</span>
                  </div>
                ) : lastConsultDurationMs !== null ? (
                  <div className="text-xs text-on-surface-variant">
                    Última consulta: <span className="font-medium">{formatElapsed(lastConsultDurationMs)}</span>
                  </div>
                ) : null}
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

              {visibleErrors.length > 0 ? (
                <div className="rounded-md bg-warning-bg p-3 text-sm text-warning-text ring-1 ring-warning-border space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p>
                      Se detectaron {visibleErrors.length} observaciones
                      {onDemandPdfMode ? ' (incluye consultas on-demand en curso).' : ' al normalizar la respuesta.'}
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
                      const errs = visibleErrors
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
                  disabled={previewTargets.length === 0 || (data.items?.length ?? 0) === 0 || onDemandPreviewLoading}
                >
                  {onDemandPreviewLoading ? 'Cargando vista previa…' : 'Vista previa PDF (primer grupo)'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void downloadAllPdfs()}
                  disabled={zipPdfCount === 0 || downloadingZip}
                >
                  {downloadingZip ? 'Generando ZIP…' : 'Descargar todo'}
                </Button>
                <span className="text-xs text-on-surface-variant self-center">
                  {zipPdfCount} PDF(s) en el ZIP
                </span>
              {onDemandPdfMode ? (
                <span className="text-xs text-warning-text self-center">
                  Modo alto volumen activo: los PDF se consultan bajo demanda.
                </span>
              ) : null}
              </div>
              {downloadingZip ? (
                <p className="text-xs text-on-surface-variant">
                  Tiempo descarga: <span className="font-medium">{formatElapsed(zipElapsedMs)}</span>
                </p>
              ) : null}
              {previewLoadError ? <p className="text-xs text-danger-text">{previewLoadError}</p> : null}
              {zipProgress ? (
                <p className="text-xs text-on-surface-variant">
                  Generando ZIP: {zipProgress.current}/{zipProgress.total} — {zipProgress.label} · Tiempo:{' '}
                  <span className="font-medium">{formatElapsed(zipElapsedMs)}</span>
                </p>
              ) : null}
              {!downloadingZip && lastZipDurationMs !== null ? (
                <p className="text-xs text-on-surface-variant">
                  Última descarga: <span className="font-medium">{formatElapsed(lastZipDurationMs)}</span>
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
                        <span className="text-xs text-on-surface-variant">
                          {(onDemandPdfMode ? tableOnDemandItems : grouped.byCuil[currentKey]).length} ítems
                        </span>
                      </div>
                      {onDemandPdfMode ? (
                        <p className="text-xs text-on-surface-variant">
                          {tableOnDemandLoading
                            ? 'Consultando datos del agente seleccionado…'
                            : 'Datos cargados bajo demanda para el agente seleccionado.'}
                        </p>
                      ) : null}
                      {onDemandPdfMode && tableOnDemandError ? (
                        <p className="text-xs text-danger-text">{tableOnDemandError}</p>
                      ) : null}
                      <ResultsTable items={onDemandPdfMode ? tableOnDemandItems : grouped.byCuil[currentKey]} />
                    </div>
                  </div>
                ) : null}

                {groupMode === 'period' && isGroupedByPeriod(grouped) && currentKey ? (
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-on-surface">Período {currentKey}</h4>
                        <span className="text-xs text-on-surface-variant">
                          {(onDemandPdfMode ? tableOnDemandItems : grouped.byPeriod[currentKey]).length} ítems
                        </span>
                      </div>
                      {onDemandPdfMode ? (
                        <p className="text-xs text-on-surface-variant">
                          {tableOnDemandLoading
                            ? 'Consultando datos del período seleccionado…'
                            : 'Datos cargados bajo demanda para el período seleccionado.'}
                        </p>
                      ) : null}
                      {onDemandPdfMode && tableOnDemandError ? (
                        <p className="text-xs text-danger-text">{tableOnDemandError}</p>
                      ) : null}
                      <ResultsTable
                        items={onDemandPdfMode ? tableOnDemandItems : grouped.byPeriod[currentKey]}
                        separatorBy="agent"
                      />
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
            currentAgent={preview.cuil}
            currentPeriod={preview.periodo}
            agentOptions={previewAgentOrder}
            periodOptions={previewPeriodOrder}
            onSelectAgent={(next: string) => void handleSelectPreviewAgent(next)}
            onSelectPeriod={(next: string) => void handleSelectPreviewPeriod(next)}
            selectingDisabled={onDemandPreviewLoading}
          />
        ) : null}
      </div>
    </div>
  )
}
