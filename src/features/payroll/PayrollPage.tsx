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
import type { NormalizedPayroll, PayrollItem } from '../../types/payroll'

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

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasValue(value: string | number | null | undefined): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  return hasText(typeof value === 'string' ? value : null)
}

function bundleHasMeaningfulData(bundle: ChequesBundle): boolean {
  const hasSecuencia = bundle.liquidacionPorSecuencia.some(
    (row) =>
      row.pesos !== null ||
      hasText(row.codigo) ||
      hasText(row.descripcionCodigo) ||
      hasText(row.apYNom) ||
      hasText(row.numDoc) ||
      hasText(row.sexo) ||
      hasText(row.cuitCuil) ||
      hasText(row.mesaPago) ||
      hasText(row.tipoOrg) ||
      hasText(row.numero) ||
      hasText(row.nombreEstab) ||
      hasText(row.tipoOrgInt) ||
      hasText(row.numeroInt) ||
      hasText(row.nombreEstabInt) ||
      hasText(row.secu) ||
      hasText(row.rev) ||
      hasText(row.estabPag) ||
      hasText(row.distritoInt) ||
      hasText(row.ccticas) ||
      hasText(row.ccticasInt) ||
      hasText(row.nomDistInt) ||
      hasText(row.cat) ||
      hasText(row.catInt) ||
      hasText(row.rural) ||
      hasText(row.ruralInt) ||
      hasText(row.secciones) ||
      hasText(row.seccionesInt) ||
      hasText(row.turnos) ||
      hasText(row.turnosInt) ||
      hasText(row.dobEscolEstab) ||
      hasText(row.esCarcel) ||
      hasText(row.esDeno) ||
      hasText(row.direccion) ||
      hasText(row.cargoReal) ||
      hasText(row.choraria) ||
      hasText(row.apoyoReal) ||
      hasText(row.cargoInt) ||
      hasText(row.apoyoInt) ||
      hasText(row.antig) ||
      hasText(row.inas) ||
      hasText(row.oPid) ||
      hasText(row.fecAfec),
  )
  if (hasSecuencia) return true

  return bundle.liquidPorEstablecimiento.some(
    (row) =>
      row.distrito !== null ||
      hasText(row.tipoOrg) ||
      row.liquido !== null ||
      hasValue(row.numero) ||
      hasText(row.nombreEstab) ||
      hasValue(row.secu) ||
      hasText(row.perOpago) ||
      hasText(row.nombreOpago) ||
      hasText(row.fecPago),
  ) || bundle.liquidPorEstablecimiento.some((row) => hasValue(row.opid))
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

  if (!bundleHasMeaningfulData(bundle) && (!bundle.errors || bundle.errors.length === 0)) {
    observations.push({
      cuil: visibleCuil,
      message: `No se pudo obtener información para el período ${periodo}. Verificá la conectividad e intentá nuevamente.`,
    })
    return observations
  }

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
      message:
        'No se detectaron pagos para este período. Es posible que todavía no estén acreditados o que haya un problema en el servicio de consulta.',
    })
  }

  if (bundle.errors && bundle.errors.length > 0) {
    const forbiddenFound = bundle.errors.some(isForbiddenErrorMessage)
    if (forbiddenFound) {
      observations.push({
        cuil: visibleCuil,
        message: 'Acceso denegado (Forbidden/403).',
      })
    }
    observations.push(
      ...bundle.errors
        .filter((msg) => (forbiddenFound ? !isForbiddenErrorMessage(msg) : true))
        .map((msg) => ({
          cuil: visibleCuil,
          message: msg,
        })),
    )
  }

  return observations
}

const PDF_TIMEOUT_MS = 60000
const ZIP_DOWNLOAD_CONCURRENCY = 4
const ZIP_FINALIZE_TIMEOUT_MS = 900000
const ZIP_MAX_ITEMS_PER_FILE = 1000
const TARGET_FETCH_KEY_SEP = '|'

function isForbiddenErrorMessage(message: string): boolean {
  const mm = message.toLowerCase()
  return (
    mm.includes('forbidden') ||
    mm.includes('http 403') ||
    mm.includes('status code 403') ||
    mm.includes('403')
  )
}

function summarizeBundleEndpointError(bundle: ChequesBundle): string | null {
  const errors = bundle.errors ?? []
  if (errors.length === 0) return null
  if (errors.some(isForbiddenErrorMessage)) {
    return 'Acceso denegado (Forbidden/403).'
  }
  return errors[0] ?? null
}

type ZipResultSummary = {
  generated: number
  skipped: number
  forbidden: number
  noInfo: number
  endpointError: number
  other: number
}

function classifySkipReason(reason: string): keyof Omit<ZipResultSummary, 'generated' | 'skipped'> {
  const msg = reason.toLowerCase()
  if (msg.includes('forbidden') || msg.includes('403') || msg.includes('acceso denegado')) return 'forbidden'
  if (msg.includes('no se encontró información') || msg.includes('sin datos')) return 'noInfo'
  if (
    msg.includes('http ') ||
    msg.includes('timeout') ||
    msg.includes('status code') ||
    msg.includes('error') ||
    msg.includes('no se pudo consultar')
  ) {
    return 'endpointError'
  }
  return 'other'
}

function classifyObservationType(message: string): string {
  const msg = message.toLowerCase()
  if (msg.includes('forbidden') || msg.includes('403') || msg.includes('acceso denegado')) {
    return 'Acceso denegado'
  }
  if (msg.includes('no se detectaron pagos')) return 'Sin pagos'
  if (msg.includes('no se encontró información') || msg.includes('no se pudo obtener información')) {
    return 'Sin información'
  }
  if (msg.includes('http ') || msg.includes('status code') || msg.includes('endpoint') || msg.includes('timeout')) {
    return 'Error de endpoint'
  }
  if (msg.includes('importe inválido')) return 'Dato inválido'
  return 'Observación general'
}

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

async function generateZipBlobWithTimeout(
  zip: JSZip,
  onProgress: (percent: number) => void,
  timeoutMs: number,
): Promise<Blob> {
  let timeoutId: number | null = null
  try {
    return (await Promise.race([
      zip.generateAsync(
        {
          type: 'blob',
          compression: 'STORE',
          streamFiles: true,
        },
        (metadata) => onProgress(metadata.percent),
      ),
      new Promise<Blob>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('zip-timeout')), timeoutMs)
      }),
    ])) as Blob
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
  }
}

function partitionTargetsByMode(targets: PdfTarget[], mode: 'agent' | 'period', chunkSize: number): PdfTarget[][] {
  if (targets.length === 0) return []
  const groups: PdfTarget[][] = []
  let currentGroup: PdfTarget[] = []
  let currentGroupKey: string | null = null

  for (const target of targets) {
    const key = mode === 'agent' ? target.cuil : target.periodo
    if (currentGroupKey === null || currentGroupKey === key) {
      currentGroup.push(target)
      currentGroupKey = key
      continue
    }
    groups.push(currentGroup)
    currentGroup = [target]
    currentGroupKey = key
  }
  if (currentGroup.length > 0) groups.push(currentGroup)

  const chunks: PdfTarget[][] = []
  let currentChunk: PdfTarget[] = []

  for (const group of groups) {
    if (group.length > chunkSize) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk)
        currentChunk = []
      }
      for (let i = 0; i < group.length; i += chunkSize) {
        chunks.push(group.slice(i, i + chunkSize))
      }
      continue
    }
    if (currentChunk.length + group.length > chunkSize) {
      chunks.push(currentChunk)
      currentChunk = [...group]
      continue
    }
    currentChunk.push(...group)
  }

  if (currentChunk.length > 0) chunks.push(currentChunk)
  return chunks
}

function buildZipRangeName(baseZipName: string, chunk: PdfTarget[], mode: 'agent' | 'period'): string {
  if (chunk.length === 0) return baseZipName
  if (mode === 'agent') {
    const fromAgent = chunk[0]?.cuil ?? 'inicio'
    const toAgent = chunk[chunk.length - 1]?.cuil ?? 'fin'
    return `${baseZipName}-agentes-${fromAgent}-a-${toAgent}`
  }
  const fromPeriod = chunk[0]?.periodo ?? 'inicio'
  const toPeriod = chunk[chunk.length - 1]?.periodo ?? 'fin'
  return `${baseZipName}-periodos-${fromPeriod}-a-${toPeriod}`
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
  const [includeOfficialWatermark, setIncludeOfficialWatermark] = useState(false)
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number; label: string } | null>(
    null,
  )
  const [zipSkipped, setZipSkipped] = useState<string[]>([])
  const [zipResultSummary, setZipResultSummary] = useState<ZipResultSummary | null>(null)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const [expandedErrorAgents, setExpandedErrorAgents] = useState<Record<string, boolean>>({})
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
  const downloadingZipRef = useRef(false)
  const bundleCacheRef = useRef(new Map<string, ChequesBundle>())
  const bundleInFlightRef = useRef(new Map<string, Promise<ChequesBundle | null>>())
  const pdfCacheRef = useRef(new Map<string, PdfEntry | null>())
  const pdfInFlightRef = useRef(new Map<string, Promise<PdfEntry | null>>())
  const pdfSkipReasonRef = useRef(new Map<string, string>())

  const clearHeavyCaches = useCallback(() => {
    bundleCacheRef.current.clear()
    bundleInFlightRef.current.clear()
    pdfCacheRef.current.clear()
    pdfInFlightRef.current.clear()
    pdfSkipReasonRef.current.clear()
  }, [])

  const cleanupAfterDownload = useCallback((options?: { preserveObservations?: boolean }) => {
    const preserveObservations = options?.preserveObservations ?? false
    clearHeavyCaches()
    setOnDemandPreview(null)
    setPreviewLoadError(null)
    setTableOnDemandItems([])
    setTableOnDemandItemsByGroup({})
    setTableOnDemandLoading(false)
    setTableOnDemandError(null)
    if (!preserveObservations) {
      setOnDemandObservations([])
      seenOnDemandObservationKeysRef.current.clear()
    }
    setZipProgress(null)
  }, [clearHeavyCaches])

  const normalizedAgentSearch = useMemo(() => agentSearch.trim().toLowerCase(), [agentSearch])
  const normalizedPeriodSearch = useMemo(() => {
    const raw = periodSearchDate.trim()
    // YYYY-MM-DD -> YYYY-MM
    return raw.length >= 7 ? raw.slice(0, 7).toLowerCase() : ''
  }, [periodSearchDate])
  const pdfRenderVariantKey = useMemo(
    () => `wm:${includeOfficialWatermark ? '1' : '0'}`,
    [includeOfficialWatermark],
  )

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
  const chequesErrorCount = useMemo(
    () => Object.values(chequesByKey).filter((bundle) => bundle.errors && bundle.errors.length > 0).length,
    [chequesByKey],
  )
  const previewTargets = pdfTargets
  const zipPdfCount = previewTargets.length
  const preview = onDemandPreview
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
    if (onDemandObservations.length === 0) return base
    const merged = [...base]
    const seen = new Set(base.map((e) => `${e.cuil}|${e.message}`))
    onDemandObservations.forEach((e) => {
      const key = `${e.cuil}|${e.message}`
      if (seen.has(key)) return
      seen.add(key)
      merged.push(e)
    })
    return merged
  }, [data, onDemandObservations])
  const visibleErrorsByAgent = useMemo(() => {
    const grouped = new Map<
      string,
      { cuil: string; messages: string[]; primaryType: string; typeRank: number; typeCounts: Map<string, number> }
    >()
    const typePriority: Record<string, number> = {
      'Acceso denegado': 5,
      'Error de endpoint': 4,
      'Dato inválido': 3,
      'Sin información': 2,
      'Sin pagos': 1,
      'Observación general': 0,
    }

    visibleErrors.forEach((e) => {
      const entry = grouped.get(e.cuil) ?? {
        cuil: e.cuil,
        messages: [],
        primaryType: 'Observación general',
        typeRank: -1,
        typeCounts: new Map<string, number>(),
      }
      entry.messages.push(e.message)
      const type = classifyObservationType(e.message)
      entry.typeCounts.set(type, (entry.typeCounts.get(type) ?? 0) + 1)
      const rank = typePriority[type] ?? 0
      if (rank > entry.typeRank) {
        entry.typeRank = rank
        entry.primaryType = type
      }
      grouped.set(e.cuil, entry)
    })

    return Array.from(grouped.values()).map((entry) => {
      const secondary = Array.from(entry.typeCounts.entries())
        .filter(([type]) => type !== entry.primaryType)
        .sort((a, b) => b[1] - a[1])[0]
      const typeLabel = secondary
        ? `${entry.primaryType} (+${secondary[0].toLowerCase()})`
        : entry.primaryType
      return { cuil: entry.cuil, messages: entry.messages, typeLabel }
    })
  }, [visibleErrors])
  const skippedErrorsByAgent = useMemo(() => {
    const grouped = new Map<string, string[]>()
    zipSkipped.forEach((line) => {
      const match = /^haberes-([^-]+)-(\d{4}-\d{2})\.pdf \((.*)\)$/.exec(line.trim())
      if (!match) return
      const [, cuil, periodo, reason] = match
      const message = `${reason} (Período ${periodo})`
      const prev = grouped.get(cuil) ?? []
      if (!prev.includes(message)) prev.push(message)
      grouped.set(cuil, prev)
    })
    return Array.from(grouped.entries()).map(([cuil, messages]) => ({
      cuil,
      messages,
      typeLabel: classifyObservationType(messages[0] ?? 'Observación general'),
    }))
  }, [zipSkipped])
  const observationsByAgent = visibleErrorsByAgent.length > 0 ? visibleErrorsByAgent : skippedErrorsByAgent
  const hasObservations = visibleErrors.length > 0 || zipSkipped.length > 0
  const observationsCount = Math.max(visibleErrors.length, zipSkipped.length)

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
        const ok = await loadOnDemandPreviewByIndex(i)
        if (!ok) return
        setPreviewIndex(i)
        return
      }
    }
  }, [previewTargets, preview, previewIndex, loadOnDemandPreviewByIndex])

  const handleNextPeriodInAgent = useCallback(async () => {
    if (!preview) return
    for (let i = previewIndex + 1; i < previewTargets.length; i += 1) {
      const p = previewTargets[i]
      if (p.cuil === preview.cuil && p.periodo !== preview.periodo) {
        const ok = await loadOnDemandPreviewByIndex(i)
        if (!ok) return
        setPreviewIndex(i)
        return
      }
    }
  }, [previewTargets, preview, previewIndex, loadOnDemandPreviewByIndex])

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
        const ok = await loadOnDemandPreviewByIndex(i)
        if (!ok) return
        setPreviewIndex(i)
        return
      }
    }
  }, [previewTargets, preview, previewIndex, loadOnDemandPreviewByIndex])

  const handleNextAgent = useCallback(async () => {
    if (!preview) return
    for (let i = previewIndex + 1; i < previewTargets.length; i += 1) {
      const p = previewTargets[i]
      if (p.cuil !== preview.cuil) {
        const ok = await loadOnDemandPreviewByIndex(i)
        if (!ok) return
        setPreviewIndex(i)
        return
      }
    }
  }, [previewTargets, preview, previewIndex, loadOnDemandPreviewByIndex])

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
        const ok = await loadOnDemandPreviewByIndex(targetIndex)
        if (!ok) return
        setPreviewIndex(targetIndex)
      }
    },
    [previewTargets, loadOnDemandPreviewByIndex],
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
        const rawBundle = await fetchChequesBundle(apiId, periodoYYYYMM, {
          attempts: 2,
        })
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
      const pdfCacheKey = `${targetKey}${TARGET_FETCH_KEY_SEP}${pdfRenderVariantKey}`
      if (pdfCacheRef.current.has(pdfCacheKey)) {
        return pdfCacheRef.current.get(pdfCacheKey) ?? null
      }
      const inFlight = pdfInFlightRef.current.get(pdfCacheKey)
      if (inFlight) return inFlight

      const run = (async () => {
        const visibleBundle = await fetchVisibleBundleForTarget(target)
        const targetSkipKey = `${target.cuil}${TARGET_FETCH_KEY_SEP}${target.periodo}`
        if (!visibleBundle) {
          pdfSkipReasonRef.current.set(
            targetSkipKey,
            `No se pudo consultar información para ${target.periodo}.`,
          )
          pdfCacheRef.current.set(pdfCacheKey, null)
          return null
        }
        const endpointError = summarizeBundleEndpointError(visibleBundle)
        if (endpointError) {
          pdfSkipReasonRef.current.set(targetSkipKey, endpointError)
          pdfCacheRef.current.set(pdfCacheKey, null)
          return null
        }
        const printableItems = bundleToPayrollItems(visibleBundle, target.cuil)
        if (printableItems.length === 0) {
          pdfSkipReasonRef.current.set(
            targetSkipKey,
            `No se encontró información para el período ${target.periodo}.`,
          )
          pdfCacheRef.current.set(pdfCacheKey, null)
          return null
        }
        const key = `${target.cuil}-${target.periodo.replace('-', '')}`
        const singleTargetData: NormalizedPayroll = {
          items: printableItems,
          agents: [
            {
              cuil: target.cuil,
              nombre: filteredData.agents.find((agent) => agent.cuil === target.cuil)?.nombre,
            },
          ],
        }
        const docs = buildAgentPdfs(
          singleTargetData,
          { [key]: visibleBundle },
          [target.cuil],
          [target.periodo],
          { includeOfficialWatermark },
        )
        const result = docs[0] ?? null
        pdfSkipReasonRef.current.delete(targetSkipKey)
        pdfCacheRef.current.set(pdfCacheKey, result)
        return result
      })()

      pdfInFlightRef.current.set(pdfCacheKey, run)
      try {
        return await run
      } finally {
        pdfInFlightRef.current.delete(pdfCacheKey)
      }
    },
    [filteredData, fetchVisibleBundleForTarget, includeOfficialWatermark, pdfRenderVariantKey],
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
    const target = previewTargets[idx]
    if (!target) return false

    try {
      setPreviewLoadError(null)
      setOnDemandPreviewLoading(true)
      const next = await buildPdfEntryForTarget(target)
      if (!next) {
        const reason =
          pdfSkipReasonRef.current.get(`${target.cuil}${TARGET_FETCH_KEY_SEP}${target.periodo}`) ??
          'No se pudo generar la vista previa para el documento/período elegido.'
        setPreviewLoadError(reason)
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

  const openPdfPreview = useCallback(async () => {
    if (previewTargets.length === 0) {
      setPreviewIndex(0)
      setOnDemandPreview(null)
      setPreviewLoadError(null)
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
    const ok = await loadOnDemandPreviewByIndex(idx)
    if (!ok) return
    setPreviewIndex(idx)
    setPdfOpen(true)
  }, [
    previewTargets,
    groupMode,
    currentKey,
    normalizedPeriodSearch,
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
    downloadingZipRef.current = downloadingZip
  }, [downloadingZip])

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
    if (Object.keys(chequesByKey).length === 0) return
    dispatch({ type: 'SET_CHEQUES_MAP', payload: {} })
  }, [chequesByKey, dispatch])

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
      const ok = await loadOnDemandPreviewByIndex(idx)
      if (!ok) return
      setPreviewIndex(idx)
    },
    [preview, previewTargets, loadOnDemandPreviewByIndex],
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
      const ok = await loadOnDemandPreviewByIndex(idx)
      if (!ok) return
      setPreviewIndex(idx)
    },
    [preview, previewTargets, loadOnDemandPreviewByIndex],
  )

  const downloadAllPdfs = useCallback(async () => {
    if (!filteredData) return

    let shouldPreserveDownloadObservations = true
    try {
      setDownloadError(null)
      setDownloadingZip(true)
      setZipProgress(null)
      setZipSkipped([])
      setZipResultSummary(null)
      const targets: PdfTarget[] = [...previewTargets].sort((a, b) => {
        if (groupMode === 'period') {
          if (a.periodo !== b.periodo) return a.periodo.localeCompare(b.periodo)
          return a.cuil.localeCompare(b.cuil)
        }
        if (a.cuil !== b.cuil) return a.cuil.localeCompare(b.cuil)
        return a.periodo.localeCompare(b.periodo)
      })
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
      const zipConcurrency = Math.min(
        8,
        Math.max(2, Math.floor((((window.navigator?.hardwareConcurrency as number | undefined) ?? 4) + 1) / 2)),
      )
      const targetChunks = partitionTargetsByMode(targets, groupMode, ZIP_MAX_ITEMS_PER_FILE)
      let totalCompleted = 0
      let totalAdded = 0
      const skipped: string[] = []
      const summary: ZipResultSummary = {
        generated: 0,
        skipped: 0,
        forbidden: 0,
        noInfo: 0,
        endpointError: 0,
        other: 0,
      }

      let lastProgressTs = 0
      for (let chunkIndex = 0; chunkIndex < targetChunks.length; chunkIndex += 1) {
        const chunk = targetChunks[chunkIndex] ?? []
        if (chunk.length === 0) continue
        const zip = new JSZip()
        let chunkAdded = 0

        await mapLimit(chunk, zipConcurrency || ZIP_DOWNLOAD_CONCURRENCY, async (target) => {
          const fallbackName = `haberes-${target.cuil}-${target.periodo}.pdf`
          try {
            const d = await buildPdfEntryForTarget(target)
            if (!d) {
              const reason =
                pdfSkipReasonRef.current.get(`${target.cuil}${TARGET_FETCH_KEY_SEP}${target.periodo}`) ?? 'sin datos'
              skipped.push(`${fallbackName} (${reason})`)
              setOnDemandObservations((prev) => {
                const key = `${target.cuil}|${target.periodo.replace('-', '')}|${reason}`
                if (seenOnDemandObservationKeysRef.current.has(key)) return prev
                seenOnDemandObservationKeysRef.current.add(key)
                return [...prev, { cuil: target.cuil, message: `${reason} (Período ${target.periodo})` }]
              })
              summary.skipped += 1
              summary[classifySkipReason(reason)] += 1
              return null
            }
            const filename = pdfFilename(d)
            const bytes = await createPdfUint8ArrayWithTimeout(d.doc, PDF_TIMEOUT_MS)
            const inner = groupMode === 'period' ? `${d.periodo}/${filename}` : `${d.cuil}/${filename}`
            const zipPath = manualDocFolder ? `${manualDocFolder}/${inner}` : inner
            zip.file(zipPath, bytes, { binary: true })
            chunkAdded += 1
            totalAdded += 1
            summary.generated += 1
            return null
          } catch (err) {
            console.error('Error al generar PDF para ZIP', fallbackName, err)
            const reason =
              err instanceof Error ? (err.message === 'timeout' ? 'timeout' : err.message) : 'error'
            skipped.push(`${fallbackName} (${reason})`)
            setOnDemandObservations((prev) => {
              const key = `${target.cuil}|${target.periodo.replace('-', '')}|${reason}`
              if (seenOnDemandObservationKeysRef.current.has(key)) return prev
              seenOnDemandObservationKeysRef.current.add(key)
              return [...prev, { cuil: target.cuil, message: `${reason} (Período ${target.periodo})` }]
            })
            summary.skipped += 1
            summary[classifySkipReason(reason)] += 1
            return null
          } finally {
            totalCompleted += 1
            const now = Date.now()
            if (totalCompleted === targets.length || totalCompleted % 5 === 0 || now - lastProgressTs >= 250) {
              lastProgressTs = now
              setZipProgress({
                current: totalCompleted,
                total: targets.length,
                label: `Procesados ${totalCompleted}/${targets.length}`,
              })
            }
          }
        })

        if (chunkAdded === 0) continue

        setZipProgress({
          current: totalCompleted,
          total: targets.length,
          label: `Empaquetando ZIP ${chunkIndex + 1}/${targetChunks.length}…`,
        })
        let lastPackedPct = -1
        const rawZipBlob = await generateZipBlobWithTimeout(
          zip,
          (percent) => {
            const pct = Math.round(percent)
            if (pct < 100 && pct - lastPackedPct < 5) return
            lastPackedPct = pct
            setZipProgress({
              current: totalCompleted,
              total: targets.length,
              label: `Empaquetando ZIP ${chunkIndex + 1}/${targetChunks.length}… ${pct}%`,
            })
          },
          ZIP_FINALIZE_TIMEOUT_MS,
        )
        const chunkBaseName = buildZipRangeName(baseZipName, chunk, groupMode)
        const chunkSuffix =
          targetChunks.length > 1 ? `-parte-${String(chunkIndex + 1).padStart(2, '0')}-de-${targetChunks.length}` : ''
        downloadBlob(rawZipBlob, `${chunkBaseName}${chunkSuffix}.zip`)
      }

      if (totalAdded === 0) {
        shouldPreserveDownloadObservations = true
        setZipSkipped(skipped)
        setZipResultSummary(summary)
        setDownloadError('No se pudo generar ningún PDF para el ZIP.')
        return
      }

      setZipSkipped(skipped)
      setZipResultSummary(summary)
      if (skipped.length > 0) {
        shouldPreserveDownloadObservations = true
      }
    } catch (e) {
      console.error('Error al generar ZIP de PDFs', e)
      const message =
        e instanceof Error && e.message === 'timeout'
          ? 'Tiempo de espera agotado para algún PDF.'
          : e instanceof Error && e.message === 'zip-timeout'
            ? 'El empaquetado del ZIP tardó demasiado y fue cancelado.'
          : null
      setDownloadError(
        `No se pudo generar el ZIP.${message ? ` ${message}` : ''} Revisá el filtro y volvé a intentar.`,
      )
      shouldPreserveDownloadObservations = true
    } finally {
      setDownloadingZip(false)
      // Luego de descargar, liberamos estado/caches transitorios para minimizar degradación.
      cleanupAfterDownload({ preserveObservations: shouldPreserveDownloadObservations })
    }
  }, [
    filteredData,
    groupMode,
    queryMode,
    manualCuil,
    previewTargets,
    buildPdfEntryForTarget,
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
                <Button type="button" onClick={() => void consult()} disabled={loading}>
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
              <label className="inline-flex items-center gap-2 text-sm text-on-surface select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={includeOfficialWatermark}
                  onChange={(e) => setIncludeOfficialWatermark(e.target.checked)}
                />
                Agregar marca de agua
              </label>
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

              {hasObservations ? (
                <div className="rounded-md bg-warning-bg p-3 text-sm text-warning-text ring-1 ring-warning-border space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p>
                      Se han detectado {observationsCount} observaciones.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-7 px-2 text-[11px] leading-none"
                      onClick={() => setShowErrorDetails((v) => !v)}
                    >
                      {showErrorDetails ? 'Ocultar' : 'Ver más'}
                    </Button>
                  </div>
                  {showErrorDetails ? (
                    <div className="space-y-2 text-xs">
                      <p className="font-semibold">Panel de observaciones por documento</p>
                      {observationsByAgent.length > 0 ? (
                        <ul className="space-y-2">
                          {observationsByAgent.map((entry) => {
                            const isOpen = expandedErrorAgents[entry.cuil] ?? false
                            return (
                              <li key={entry.cuil} className="rounded border border-warning-border/60 p-2">
                                <div className="flex items-center gap-3">
                                  <div className="min-w-0 flex items-center gap-2">
                                    <button
                                      type="button"
                                      className="h-6 w-6 rounded border border-warning-border/60 text-[14px] leading-none text-warning-text"
                                      aria-label={isOpen ? `Ocultar observaciones de ${entry.cuil}` : `Ver observaciones de ${entry.cuil}`}
                                      onClick={() =>
                                        setExpandedErrorAgents((prev) => ({
                                          ...prev,
                                          [entry.cuil]: !isOpen,
                                        }))
                                      }
                                    >
                                      {isOpen ? '−' : '+'}
                                    </button>
                                    <span className="font-mono">{entry.cuil}</span>
                                    {entry.messages.length > 0 ? (
                                      <span className="text-on-surface-variant">
                                        {' - '}
                                        {entry.typeLabel}
                                        {entry.messages.length > 1 ? ` (${entry.messages.length} observaciones)` : ''}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                {isOpen ? (
                                  <ul className="mt-2 list-disc pl-5 text-on-surface-variant">
                                    {entry.messages.map((message, idx) => (
                                      <li key={`${entry.cuil}-${idx}`}>{message}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </li>
                            )
                          })}
                        </ul>
                      ) : null}
                    </div>
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
              </div>
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
              {zipResultSummary ? (
                <p className="text-xs text-on-surface-variant">
                  Resultado ZIP — Generados: {zipResultSummary.generated} · Omitidos: {zipResultSummary.skipped} ·
                  Forbidden: {zipResultSummary.forbidden} · Sin información: {zipResultSummary.noInfo} · Error
                  endpoint: {zipResultSummary.endpointError}
                  {zipResultSummary.other > 0 ? ` · Otros: ${zipResultSummary.other}` : ''}
                </p>
              ) : null}
              {zipSkipped.length > 0 ? (
                <p className="text-xs text-warning-text">
                  Se omitieron {zipSkipped.length} PDF(s). Revisá el panel "Observaciones" para ver el detalle
                  por documento/período.
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
                          {tableOnDemandItems.length} ítems
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant">
                        {tableOnDemandLoading
                          ? 'Consultando datos del agente seleccionado…'
                          : 'Datos cargados bajo demanda para el agente seleccionado.'}
                      </p>
                      {tableOnDemandError ? (
                        <p className="text-xs text-danger-text">{tableOnDemandError}</p>
                      ) : null}
                      <ResultsTable items={tableOnDemandItems} />
                    </div>
                  </div>
                ) : null}

                {groupMode === 'period' && isGroupedByPeriod(grouped) && currentKey ? (
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-on-surface">Período {currentKey}</h4>
                        <span className="text-xs text-on-surface-variant">
                          {tableOnDemandItems.length} ítems
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant">
                        {tableOnDemandLoading
                          ? 'Consultando datos del período seleccionado…'
                          : 'Datos cargados bajo demanda para el período seleccionado.'}
                      </p>
                      {tableOnDemandError ? (
                        <p className="text-xs text-danger-text">{tableOnDemandError}</p>
                      ) : null}
                      <ResultsTable
                        items={tableOnDemandItems}
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
