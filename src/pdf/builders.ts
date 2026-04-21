import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { GroupMode, NormalizedPayroll, PayrollItem } from '../types/payroll'
import type { ChequesBundle, LiquidPorEstablecimientoItem, LiquidacionPorSecuenciaItem } from '../types/cheques'
import { groupByAgent, groupByPeriod } from '../utils/grouping'
import { RECEIPT_HEADER_LINES } from './receiptConstants'

function pesos(value: number): string {
  // Similar al recibo ejemplo: sin símbolo $, con coma decimal.
  const abs = Math.abs(value)
  return abs.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function yyyymm(period: string): string {
  return period.replace('-', '')
}

function mesPago(period: string): string {
  // YYYY-MM -> MM / YYYY
  const y = period.slice(0, 4)
  const m = period.slice(5, 7)
  return `${m} / ${y}`
}

function yyyymmToPeriod(yyyymmValue: string | null | undefined): string | null {
  const s = String(yyyymmValue ?? '')
    .replace(/\D/g, '')
    .trim()
  if (s.length !== 6) return null
  return `${s.slice(0, 4)}-${s.slice(4, 6)}`
}

function formatDateDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function formatEstablecimientoRow(it: LiquidPorEstablecimientoItem): string {
  const d = it.distrito == null ? '---' : String(it.distrito).padStart(3, '0')
  const org = (it.tipoOrg ?? '--').toString().padStart(2, '0').replace(/^0/, '').trim() || (it.tipoOrg ?? '--')
  const num = it.numero == null ? '----' : String(it.numero).padStart(4, '0')
  return `${d} ${org} ${num}`.trim()
}

/** C.horaria del JSON (hs): mismo criterio que el recibo en papel. */
function formatHsDisplay(value: string | null | undefined): string {
  if (value == null || !String(value).trim()) return '—'
  const n = parseFloat(String(value).replace(',', '.'))
  if (Number.isNaN(n)) return String(value).trim()
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pickOrdenPagoPadded(opids: string[]): string {
  const trimmed = opids.map((x) => x.trim()).filter((x) => x.length > 0)
  if (trimmed.length === 0) return '—'
  const nums = trimmed
    .map((o) => parseInt(o, 10))
    .filter((n) => !Number.isNaN(n))
  if (nums.length > 0) {
    const min = Math.min(...nums)
    return String(min).padStart(5, '0')
  }
  return trimmed[0]
}

const RECEIPT_SECTION_HEADER_FILL = '#e5e7eb'

function sumLiquid(rows: LiquidPorEstablecimientoItem[]): number {
  return rows.reduce((acc, r) => acc + (r.liquido ?? 0), 0)
}

function groupCodes(
  items: LiquidacionPorSecuenciaItem[],
): Array<{ codigo: string; desc: string; haberes: number; descuentos: number }> {
  const map = new Map<string, { codigo: string; desc: string; haberes: number; descuentos: number }>()
  for (const it of items) {
    const codigo = (it.codigo ?? '').trim()
    const desc = it.descripcionCodigo ?? 'Sin descripción'
    const amount = it.pesos ?? 0
    const esDeno = String(it.esDeno ?? '').trim()
    const isDescuentoCode = codigo.startsWith('9') || codigo.startsWith('1')
    const haberes = esDeno === '0' && !isDescuentoCode ? amount : 0
    const descuentos = esDeno === '0' && isDescuentoCode ? Math.abs(amount) : 0
    const key = `${codigo}||${desc}`
    const prev = map.get(key)
    if (prev) {
      prev.haberes += haberes
      prev.descuentos += descuentos
    } else {
      map.set(key, { codigo, desc, haberes, descuentos })
    }
  }
  return Array.from(map.values()).sort((a, b) => a.codigo.localeCompare(b.codigo))
}

function esCarcelFromCcticas(value: string | null): 'S' | 'N' {
  if (!value) return 'N'
  return String(value).toUpperCase().includes('P') ? 'S' : 'N'
}

function dobleEscolFromCcticas(value: string | null): 'S' | 'N' {
  if (!value) return 'N'
  return String(value).toUpperCase().includes('C') ? 'S' : 'N'
}

function revistaAlias(value: string | null): string {
  const v = String(value ?? '')
    .trim()
    .toUpperCase()
  if (!v) return 'OTRO'
  if (v === 'T') return 'TIT'
  if (v === 'P') return 'PROV'
  if (v === 'S') return 'SUP'
  if (v === 'R') return 'REEMP'
  if (v === 'M') return 'MENS'
  if (v === 'D') return 'DEST'
  if (v === 'E') return 'SIN EST'
  return 'OTRO'
}

function haberesHeaderTitle(items: LiquidacionPorSecuenciaItem[]): string {
  const dipregep = items.some((it) => String(it.esDeno ?? '').trim() === '1')
  return dipregep
    ? 'Recuerde que el recibo de haberes correspondiente a DIPREGEP debe retirarlo del Establecimiento'
    : 'HABERES'
}

const separatorOnlyRowLayout = {
  // En una tabla de 2 filas, hay 3 líneas horizontales (top, middle, bottom).
  // Dibujamos solo la del medio para separar las dos líneas de texto.
  hLineWidth: (i: number) => (i === 1 ? 0.8 : 0),
  vLineWidth: () => 0,
  paddingLeft: () => 0,
  paddingRight: () => 0,
  paddingTop: () => 0,
  paddingBottom: () => 0,
  hLineColor: () => '#111827',
}

type SecuenciaGroup = {
  key: string
  meta: {
    estabCode: string
    leftLine1: string
    leftLine2: string
    nombreEstab: string
    categoria: string
    desfavorabilidad: string
    secciones: string
    esCarcel: string
    dobleEscol: string
    turnos: string
    secuencia: string
    revista: string
    cargoReal: string
    choraria: string
    apoyoReal: string
    cargoInt: string
    apoyoInt: string
    periodoLiqSix: string
    ordenPagoPadded: string
    antiguedad: string
    inasistencias: string
    interino: null | {
      leftLine1: string
      leftLine2: string
      nombreEstab: string
      categoria: string
      desfavorabilidad: string
      secciones: string
      esCarcel: string
      dobleEscol: string
      turnos: string
    }
  }
  items: LiquidacionPorSecuenciaItem[]
}

function normalizeDigits(value: unknown): string {
  return String(value ?? '')
    .replace(/\D/g, '')
    .trim()
}

function padLeftDigits(value: unknown, len: number, emptyFallback: string): string {
  const d = normalizeDigits(value)
  if (!d) return emptyFallback
  return d.padStart(len, '0')
}

function normalizeOrg(value: unknown): string {
  return String(value ?? '').trim()
}

function estabKey(tipoOrg: unknown, numero: unknown): string {
  const org = normalizeOrg(tipoOrg).toUpperCase()
  const num = normalizeDigits(numero).replace(/^0+(?=\d)/, '') // sin ceros a la izquierda para matchear robusto
  return `${org}|${num || ''}`
}

function buildEstabIndex(rows: LiquidPorEstablecimientoItem[]): Map<string, LiquidPorEstablecimientoItem> {
  const map = new Map<string, LiquidPorEstablecimientoItem>()
  for (const r of rows) {
    const key = estabKey(r.tipoOrg, r.numero)
    if (!key) continue
    const prev = map.get(key)
    // Preferimos la fila que tenga distrito informado.
    if (!prev || (prev.distrito == null && r.distrito != null)) map.set(key, r)
  }
  return map
}

function groupBySecuencia(
  items: LiquidacionPorSecuenciaItem[],
  fallbackPeriodo: string,
  estabRows: LiquidPorEstablecimientoItem[] = [],
): SecuenciaGroup[] {
  const map = new Map<string, SecuenciaGroup>()
  const estabIndex = buildEstabIndex(estabRows)

  for (const it of items) {
    const tipoOrg = (it.tipoOrg ?? '').trim()
    const numero = (it.numero ?? '').trim()
    const secu = (it.secu ?? '').trim()
    const nombreEstab = (it.nombreEstab ?? '').trim()
    const rev = (it.rev ?? '').trim()
    const periodoLiq = yyyymmToPeriod(it.mesaPago)?.trim() || yyyymmToPeriod(it.fecAfec)?.trim() || fallbackPeriodo

    const estabCode = tipoOrg && numero ? `${tipoOrg}-${numero}` : '—'
    // No separamos por oPid para evitar bloques duplicados casi idénticos en el PDF.
    // El/los oPid se informan en conjunto dentro del bloque.
    const key = [estabCode, secu, rev, periodoLiq, nombreEstab].join('|')

    if (!map.has(key)) {
      const estab = estabIndex.get(estabKey(tipoOrg, numero))
      // Requerimiento: cuando venga null/vacío, mostrar '-' (un solo guion).
      const distrito3 = padLeftDigits(estab?.distrito ?? it.distritoInt, 3, '-')
      const nomDist = String(it.nomDistInt ?? '').trim() || '-'
      const orgForLine2 = (normalizeOrg(estab?.tipoOrg ?? tipoOrg) || '-').toUpperCase()
      const numero4 = padLeftDigits(estab?.numero ?? numero, 4, '-')

      const leftLine1 = (() => {
        const parts = [distrito3, nomDist].filter((p) => p !== '-')
        return parts.length ? parts.join(' ') : '-'
      })()

      const leftLine2 = (() => {
        const orgOk = orgForLine2 !== '-'
        const numOk = numero4 !== '-'
        if (orgOk && numOk) return `${orgForLine2}-${numero4}`
        if (orgOk) return orgForLine2
        if (numOk) return numero4
        return '-'
      })()
      const interinoDistritoRaw = String(it.distritoInt ?? '').trim()
      const interino = (() => {
        if (!interinoDistritoRaw) return null
        const distrito3Int = padLeftDigits(interinoDistritoRaw, 3, '-')
        const nomDistInt = String(it.nomDistInt ?? '').trim() || '-'
        const tipoOrgInt = (normalizeOrg(it.tipoOrgInt) || '-').toUpperCase()
        const numeroInt = padLeftDigits(it.numeroInt, 4, '-')
        const leftLine1Int = [distrito3Int, nomDistInt].filter((p) => p !== '-').join(' ') || '-'
        const leftLine2Int = (() => {
          const orgOk = tipoOrgInt !== '-'
          const numOk = numeroInt !== '-'
          if (orgOk && numOk) return `${tipoOrgInt}-${numeroInt}`
          if (orgOk) return tipoOrgInt
          if (numOk) return numeroInt
          return '-'
        })()
        return {
          leftLine1: leftLine1Int,
          leftLine2: leftLine2Int,
          nombreEstab: (it.nombreEstabInt ?? '').trim() || '—',
          categoria: '',
          desfavorabilidad: (it.ruralInt ?? '').trim() || '—',
          secciones: (it.seccionesInt ?? '').trim() || '—',
          esCarcel: esCarcelFromCcticas(it.ccticasInt),
          dobleEscol: dobleEscolFromCcticas(it.ccticasInt),
          turnos: (it.turnosInt ?? '').trim() || '—',
        }
      })()

      const mesaRaw = String(it.mesaPago ?? it.fecAfec ?? '')
        .replace(/\D/g, '')
        .trim()
      const periodoLiqSix =
        mesaRaw.length >= 6 ? mesaRaw.slice(0, 6) : yyyymm(periodoLiq).replace(/\D/g, '').slice(0, 6)

      map.set(key, {
        key,
        meta: {
          estabCode,
          // Requerimiento:
          // - Arriba: distrito (3 dígitos, desde liquidPorEstablecimiento) - nomDistInt (desde liquidacionPorSecuencia)
          // - Abajo: tipoOrg + número (4 dígitos, desde liquidPorEstablecimiento)
          leftLine1,
          leftLine2,
          nombreEstab: nombreEstab || '—',
          categoria: '',
          desfavorabilidad: (it.rural ?? '').trim() || '—',
          secciones: (it.secciones ?? '').trim() || '—',
          esCarcel: esCarcelFromCcticas(it.ccticas),
          dobleEscol: dobleEscolFromCcticas(it.ccticas),
          turnos: (it.turnos ?? '').trim() || '—',
          secuencia: secu || '—',
          revista: revistaAlias(rev),
          cargoReal: (it.cat ?? '').trim() || '',
          choraria: formatHsDisplay(it.choraria),
          apoyoReal: (it.apoyoReal ?? '').trim() || '',
          cargoInt: (it.catInt ?? '').trim() || '',
          apoyoInt: (it.apoyoInt ?? '').trim() || '',
          periodoLiqSix: periodoLiqSix || yyyymm(fallbackPeriodo),
          ordenPagoPadded: '—',
          antiguedad: (it.antig ?? '').trim() || '—',
          inasistencias: (it.inas ?? '').trim() || '0.00',
          interino,
        },
        items: [],
      })
    }

    map.get(key)!.items.push(it)
  }

  // Orden estable: por estabCode, secuencia, revista
  const out = Array.from(map.values())
  for (const g of out) {
    const opids = Array.from(
      new Set(
        g.items
          .map((x) => (x.oPid ?? '').trim())
          .filter((x) => x.length > 0),
      ),
    )
    g.meta.ordenPagoPadded = pickOrdenPagoPadded(opids)
  }

  return out.sort((a, b) => {
    const aKey = `${a.meta.estabCode}-${a.meta.secuencia}-${a.meta.revista}`
    const bKey = `${b.meta.estabCode}-${b.meta.secuencia}-${b.meta.revista}`
    return aKey.localeCompare(bKey)
  })
}

function sectionTotal(items: PayrollItem[]): number {
  return items.reduce((acc, it) => acc + it.importe, 0)
}

function splitHaberes(items: PayrollItem[]): { haberes: PayrollItem[]; descuentos: PayrollItem[] } {
  const haberes: PayrollItem[] = []
  const descuentos: PayrollItem[] = []
  for (const it of items) {
    if (it.importe >= 0) haberes.push(it)
    else descuentos.push(it)
  }
  return { haberes, descuentos }
}

function cell(text: string, style?: string, extra?: Partial<TableCell>): TableCell {
  return { text, style, ...(extra ?? {}) } as unknown as TableCell
}

const BOXED_CELL_PADDING_X = 4
const BOXED_CELL_PADDING_Y = 2.5

const boxedLayout = {
  hLineWidth: () => 0.8,
  vLineWidth: () => 0.8,
  hLineColor: () => '#111827',
  vLineColor: () => '#111827',
  paddingLeft: () => BOXED_CELL_PADDING_X,
  paddingRight: () => BOXED_CELL_PADDING_X,
  paddingTop: () => BOXED_CELL_PADDING_Y,
  paddingBottom: () => BOXED_CELL_PADDING_Y,
}

const boxedLayoutRoomy = {
  ...boxedLayout,
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 4,
  paddingBottom: () => 4,
}

const boxedLayoutCaract = {
  hLineWidth: () => 0.8,
  vLineWidth: () => 0.8,
  hLineColor: () => '#111827',
  vLineColor: () => '#111827',
  paddingLeft: () => 1.5,
  paddingRight: () => 1.5,
  paddingTop: () => 1,
  paddingBottom: () => 1,
}

const boxedLayoutNoPadding = {
  ...boxedLayout,
  paddingLeft: () => 0,
  paddingRight: () => 0,
  paddingTop: () => 0,
  paddingBottom: () => 0,
}

const boxedLayoutCaractNoTopNoSides = {
  ...boxedLayoutCaract,
  // El borde inferior lo dibuja la tabla contenedora; acá dejamos solo divisores internos.
  hLineWidth: (i: number) => (i === 1 || i === 2 ? 0.8 : 0),
  // Solo quitamos bordes externos: izq de CAT y der de TUR.
  vLineWidth: (i: number) => (i === 0 || i === 6 ? 0 : 0.8),
}

const boxedLayoutNameMiddleDivider = {
  ...boxedLayoutCaract,
  // Solo la línea entre "NOMBRE DEL ESTABLECIMIENTO" y su dato.
  hLineWidth: (i: number) => (i === 1 ? 0.8 : 0),
  vLineWidth: () => 0,
}

function sectionLabel(text: string): TableCell {
  return cell(text, 'sectionBox', { colSpan: 6, fillColor: '#f9fafb' })
}

function boxedBlock(inner: Content, marginBottom: number = 8, roomy: boolean = false): Content {
  return {
    table: {
      widths: ['*'],
      body: [[inner]],
    },
    layout: roomy ? boxedLayoutRoomy : boxedLayout,
    margin: [0, 0, 0, marginBottom],
  }
}

export function buildPdfByAgent(
  normalized: NormalizedPayroll,
  selectedAgents?: string[],
  selectedPeriods?: string[],
): TDocumentDefinitions {
  // Mantener compatibilidad: este modo arma un reporte, no el recibo oficial.
  // El recibo oficial se genera en buildAgentPdfs/buildPeriodPdfs.
  const filtered: NormalizedPayroll = {
    ...normalized,
    items: normalized.items.filter(
      (it) =>
        (!selectedAgents || selectedAgents.includes(it.cuil)) &&
        (!selectedPeriods || selectedPeriods.includes(it.periodo)),
    ),
  }
  const { byCuil, orderedCuils } = groupByAgent(filtered)
  const content: Content[] = [{ text: 'Haberes - Agrupado por Agente', style: 'h1' }]
  for (const cuil of orderedCuils) {
    const items = byCuil[cuil]
    content.push({ text: `Agente: ${cuil}`, style: 'h2', margin: [0, 10, 0, 6] })
    content.push(
      buildItemsTable(items, ['Período', 'Concepto', 'Importe'], (it) => [
        it.periodo,
        it.concepto,
        { text: pesos(it.importe), alignment: 'right' },
      ]),
    )
    content.push({
      text: `Total agente: ${pesos(sectionTotal(items))}`,
      style: 'total',
      margin: [0, 6, 0, 0],
    })
  }
  return baseDoc(content)
}

export function buildPdfByPeriod(
  normalized: NormalizedPayroll,
  selectedAgents?: string[],
  selectedPeriods?: string[],
): TDocumentDefinitions {
  // Mantener compatibilidad: este modo arma un reporte, no el recibo oficial.
  // El recibo oficial se genera en buildAgentPdfs/buildPeriodPdfs.
  const filtered: NormalizedPayroll = {
    ...normalized,
    items: normalized.items.filter(
      (it) =>
        (!selectedAgents || selectedAgents.includes(it.cuil)) &&
        (!selectedPeriods || selectedPeriods.includes(it.periodo)),
    ),
  }
  const { byPeriod, orderedPeriods } = groupByPeriod(filtered)
  const content: Content[] = [{ text: 'Haberes - Agrupado por Período', style: 'h1' }]
  for (const period of orderedPeriods) {
    const items = byPeriod[period]
    content.push({ text: `Período: ${period}`, style: 'h2', margin: [0, 10, 0, 6] })
    content.push(
      buildItemsTable(items, ['Documento', 'Concepto', 'Importe'], (it) => [
        it.cuil,
        it.concepto,
        { text: pesos(it.importe), alignment: 'right' },
      ]),
    )
    content.push({
      text: `Total período: ${pesos(sectionTotal(items))}`,
      style: 'total',
      margin: [0, 6, 0, 0],
    })
  }
  return baseDoc(content)
}

export interface PeriodPdf {
  periodo: string
  doc: TDocumentDefinitions
}

export interface AgentPdf {
  cuil: string
  doc: TDocumentDefinitions
}

// Nuevo: 1 PDF por agente y por período.
export interface AgentPeriodPdf {
  cuil: string
  periodo: string
  doc: TDocumentDefinitions
}

function buildReceiptPage({
  documento,
  periodo,
  items,
  agentName,
  cheques,
}: {
  documento: string
  periodo: string
  items: PayrollItem[]
  agentName: string
  cheques?: ChequesBundle
}): Content[] {
  const now = new Date()
  const { haberes, descuentos } = splitHaberes(items)

  const secuGroups: SecuenciaGroup[] =
    cheques?.liquidacionPorSecuencia?.length
      ? groupBySecuencia(cheques.liquidacionPorSecuencia, periodo, cheques?.liquidPorEstablecimiento ?? [])
      : []

  const head = secuGroups[0]?.items?.[0] ?? cheques?.liquidacionPorSecuencia?.[0]
  const nombre = head?.apYNom ?? agentName
  const sexo = head?.sexo ?? '—'
  const cuitCuil = head?.cuitCuil ? head.cuitCuil : '—'
  const liquidRows = cheques?.liquidPorEstablecimiento ?? []
  const total = liquidRows.length > 0 ? sumLiquid(liquidRows) : sectionTotal(items)

  const headerBlock = boxedBlock(
    {
      stack: [
        {
          text: RECEIPT_HEADER_LINES.join('\n'),
          style: 'header',
          alignment: 'center',
          margin: [0, 2, 0, 8],
        },
        {
          table: {
            headerRows: 1,
            // Achicamos TIPO DOC. y SEXO para dar más espacio a número, CUIL y mes.
            widths: ['*', 45, 80, 30, 105, 80],
            body: [
              [
                cell('APELLIDO Y NOMBRE', 'thData'),
                cell('TIPO DOC.', 'thData'),
                cell('NUMERO', 'thData'),
                cell('SEXO', 'thData'),
                cell('CUIT/CUIL', 'thData'),
                cell('MES DE PAGO', 'thData'),
              ],
              [
                cell(nombre || '—', 'tdData'),
                cell('DNI', 'tdData'),
                cell(documento, 'tdData'),
                cell(sexo || '—', 'tdData'),
                cell(cuitCuil, 'tdData'),
                cell(mesPago(periodo), 'tdData'),
              ],
            ],
          },
          layout: boxedLayout,
        },
      ],
    },
    10,
    true,
  )

  const liquidosBlock = boxedBlock(
    {
      table: {
        widths: [70, 30, 55, 65, '*', 65],
        body: [
          [
            sectionLabel('LIQUIDOS'),
            cell('', 'td'),
            cell('', 'td'),
            cell('', 'td'),
            cell('', 'td'),
            cell('', 'td'),
          ],
          [
            cell('ESTABLECIMIENTO', 'thSmall'),
            cell('SEC.', 'thSmall'),
            cell('PERIODO LIQ.', 'thSmall'),
            cell('FECHA DE PAGO', 'thSmall'),
            cell('ORDEN DE PAGO', 'thSmall'),
            cell('PESOS', 'thSmall', { alignment: 'right' }),
          ],
          ...(liquidRows.length > 0
            ? liquidRows.map((r) => [
                cell(formatEstablecimientoRow(r), 'td'),
                cell(r.secu == null ? '—' : String(r.secu), 'td'),
                cell(mesPago(yyyymmToPeriod(r.perOpago) ?? periodo), 'td'),
                cell(r.fecPago ?? formatDateDDMMYYYY(now), 'td'),
                cell(r.nombreOpago ? `${r.opid ?? ''} - ${r.nombreOpago}`.trim() : '—', 'td'),
                cell(pesos(r.liquido ?? 0), 'td', { alignment: 'right' }),
              ])
            : [
                [
                  cell('—', 'td'),
                  cell('—', 'td'),
                  cell(yyyymm(periodo), 'td'),
                  cell(formatDateDDMMYYYY(now), 'td'),
                  cell('—', 'td'),
                  cell(pesos(total), 'td', { alignment: 'right' }),
                ],
              ]),
          [
            cell('', 'td', { colSpan: 4 }),
            cell('', 'td'),
            cell('', 'td'),
            cell('', 'td'),
            cell('TOTAL', 'thSmall'),
            cell(pesos(total), 'thSmall', { alignment: 'right' }),
          ],
        ],
      },
      layout: boxedLayout,
    },
    8,
  )

  const secuenciaBlocks: Content[] =
    secuGroups.length > 0
      ? secuGroups.flatMap((g) => {
          // El encabezado de la columna ya dice "ORDEN DE PAGO"; acá mostramos sólo el valor.
          const ordenLabel = g.meta.ordenPagoPadded !== '—' ? g.meta.ordenPagoPadded : '—'
          const interino = g.meta.interino
          const establecimientoCaractRealRow = [
            g.meta.categoria,
            g.meta.desfavorabilidad,
            g.meta.secciones,
            g.meta.esCarcel,
            g.meta.dobleEscol,
            g.meta.turnos,
          ] as const
          const establecimientoCaractInterinoRow = interino
            ? ([
                interino.categoria,
                interino.desfavorabilidad,
                interino.secciones,
                interino.esCarcel,
                interino.dobleEscol,
                interino.turnos,
              ] as const)
            : null
          const buildEstablecimientoContainer = ({
            leftLine1,
            leftLine2,
            nombreEstab,
            caract,
            isInterino = false,
            marginTop = 0,
          }: {
            leftLine1: string
            leftLine2: string
            nombreEstab: string
            caract: readonly [string, string, string, string, string, string]
            isInterino?: boolean
            marginTop?: number
          }): Content => ({
            table: {
              widths: [50, '*', 96],
              body: [
                [
                  {
                    table: {
                      widths: ['*'],
                      body: [
                        [cell(leftLine1, 'tdTiny', { alignment: 'center' })],
                        [cell(leftLine2, 'tdTiny', { alignment: 'center' })],
                      ],
                    },
                    layout: separatorOnlyRowLayout,
                  },
                  {
                    table: {
                      widths: ['*', '*', '*', '*', '*', '*'],
                      body: [
                        [
                          {
                            text: isInterino
                              ? 'CARACTERISTICAS DEL ESTABLECIMIENTO INTERINO'
                              : 'CARACTERISTICAS DEL ESTABLECIMIENTO',
                            style: 'sectionBoxCaract',
                            colSpan: 6,
                            alignment: 'center',
                            fillColor: RECEIPT_SECTION_HEADER_FILL,
                          },
                          {},
                          {},
                          {},
                          {},
                          {},
                        ],
                        [
                          cell('CATEGORIA', 'thCaract', { alignment: 'center' }),
                          cell('DESFAVORABILIDAD', 'thCaract', { alignment: 'center' }),
                          cell('SECCIONES', 'thCaract', { alignment: 'center' }),
                          cell('ES CARCEL', 'thCaract', { alignment: 'center' }),
                          cell('DOBLE ESCOL', 'thCaract', { alignment: 'center' }),
                          cell('TURNOS', 'thCaract', { alignment: 'center' }),
                        ],
                        [
                          cell(caract[0], 'tdCaract', { alignment: 'center' }),
                          cell(caract[1], 'tdCaract', { alignment: 'center' }),
                          cell(caract[2], 'tdCaract', { alignment: 'center' }),
                          cell(caract[3], 'tdCaract', { alignment: 'center' }),
                          cell(caract[4], 'tdCaract', { alignment: 'center' }),
                          cell(caract[5], 'tdCaract', { alignment: 'center' }),
                        ],
                      ],
                    },
                    layout: boxedLayoutCaractNoTopNoSides,
                  },
                  {
                    table: {
                      widths: ['*'],
                      body: [
                        [
                          {
                            text: 'NOMBRE DEL ESTABLECIMIENTO',
                            style: 'sectionBoxCaract',
                            alignment: 'center',
                            fillColor: RECEIPT_SECTION_HEADER_FILL,
                          },
                        ],
                        // Evitamos estirar toda la fila exterior para que no aparezca hueco en "CARACTERISTICAS".
                        [cell(nombreEstab, 'tdCaract', { margin: [0, 2, 0, 2] })],
                      ],
                    },
                    layout: boxedLayoutNameMiddleDivider,
                  },
                ],
              ],
            },
            layout: boxedLayoutNoPadding,
            ...(marginTop > 0 ? { margin: [0, marginTop, 0, 0] } : {}),
          })

          const establecimientoReal = buildEstablecimientoContainer({
            leftLine1: g.meta.leftLine1,
            leftLine2: g.meta.leftLine2,
            nombreEstab: g.meta.nombreEstab,
            caract: establecimientoCaractRealRow,
            isInterino: false,
          })
          const establecimientoInterino =
            interino && establecimientoCaractInterinoRow
              ? buildEstablecimientoContainer({
                  leftLine1: interino.leftLine1,
                  leftLine2: interino.leftLine2,
                  nombreEstab: interino.nombreEstab,
                  caract: establecimientoCaractInterinoRow,
                  isInterino: true,
                  marginTop: 4,
                })
              : null

          const caracteristicasYsecuenciaTop = {
            stack: [establecimientoReal, ...(establecimientoInterino ? [establecimientoInterino] : [])],
            margin: [0, 0, 0, 6],
          }

          const filaSecuenciaLiquidacion = {
            table: {
              widths: [38, 36, 48, 40, 44, 44, 44, 52, '*'],
              body: [
                [
                  cell('SECUENCIA', 'thTiny'),
                  cell('REVISTA', 'thTiny'),
                  cell('CARGO REAL', 'thTiny'),
                  cell('C.HORARIA', 'thTiny'),
                  cell('APOYO REAL', 'thTiny'),
                  cell('CARGO INT.', 'thTiny'),
                  cell('APOYO INT.', 'thTiny'),
                  cell('PERIODO LIQ.', 'thTiny'),
                  cell('ORDEN DE PAGO', 'thTiny', { alignment: 'right' }),
                ],
                [
                  cell(g.meta.secuencia, 'tdTiny'),
                  cell(g.meta.revista, 'tdTiny'),
                  cell(g.meta.cargoReal, 'tdTiny'),
                  cell(g.meta.choraria, 'tdTiny'),
                  cell(g.meta.apoyoReal, 'tdTiny'),
                  cell(g.meta.cargoInt, 'tdTiny'),
                  cell(g.meta.apoyoInt, 'tdTiny'),
                  cell(g.meta.periodoLiqSix, 'tdTiny'),
                  cell(ordenLabel, 'tdTiny', { alignment: 'right' }),
                ],
              ],
            },
            layout: boxedLayout,
            margin: [0, 0, 0, 8],
          }

          const conceptosInner = {
            stack: [
              {
                table: {
                  headerRows: 2,
                  widths: [48, '*', 72, 72],
                  body: [
                    [
                      {
                        text: haberesHeaderTitle(g.items),
                        style: 'sectionBox',
                        colSpan: 4,
                        alignment: 'center',
                        fillColor: RECEIPT_SECTION_HEADER_FILL,
                      },
                      {},
                      {},
                      {},
                    ],
                    [
                      cell('COD', 'thSmall'),
                      cell('HABERES', 'thSmall'),
                      cell('Haberes', 'thSmall', { alignment: 'right' }),
                      cell('Descuentos', 'thSmall', { alignment: 'right' }),
                    ],
                    ...groupCodes(g.items)
                      .filter((c) => c.haberes !== 0 || c.descuentos !== 0)
                      .map((c) => [
                        cell(c.codigo || '', 'td'),
                        cell((c.desc ?? '').trim(), 'td'),
                        cell(c.haberes !== 0 ? pesos(c.haberes) : '', 'td', { alignment: 'right' }),
                        cell(c.descuentos !== 0 ? pesos(c.descuentos) : '', 'td', { alignment: 'right' }),
                      ]),
                  ],
                },
                layout: {
                  ...boxedLayout,
                  vLineStyle: (i: number) => (i === 3 ? 'dashed' : 'solid'),
                },
              },
              {
                columns: [
                  { text: `ANTIGUEDAD EN AÑOS: ${g.meta.antiguedad}`, width: 'auto' },
                  { text: 'RURAL ARTICULACION:', width: 'auto' },
                  { text: 'DIAS TRABAJADOS:', width: 'auto' },
                  { text: `INASISTENCIAS: ${g.meta.inasistencias}`, width: 'auto' },
                ],
                columnGap: 18,
                style: 'tdTiny',
                margin: [0, 6, 0, 0],
              },
            ],
          } as unknown as Content

          const conceptosBlock = boxedBlock(conceptosInner, 10)

          return [
            // Mantenemos juntos encabezado + fila de secuencia para legibilidad,
            // pero permitimos que conceptos se ubique en la página siguiente si hace falta.
            {
              stack: [
                caracteristicasYsecuenciaTop as unknown as Content,
                filaSecuenciaLiquidacion as unknown as Content,
              ],
              unbreakable: true,
            } as Content,
            conceptosBlock,
          ]
        })
      : [
          // Fallback: si no hay secuencias, mantenemos tabla de conceptos desde items normalizados.
          boxedBlock(
            {
              table: {
                headerRows: 1,
                widths: [40, '*', 80, 80],
                body: [
                  [
                    cell('COD', 'thSmall'),
                    cell('HABERES', 'thSmall'),
                    cell('Haberes', 'thSmall', { alignment: 'right' }),
                    cell('Descuentos', 'thSmall', { alignment: 'right' }),
                  ],
                  ...[...haberes, ...descuentos].map((it) => [
                    cell('', 'td'),
                    cell(it.concepto, 'td'),
                    cell(it.importe >= 0 ? pesos(it.importe) : '', 'td', { alignment: 'right' }),
                    cell(it.importe < 0 ? pesos(it.importe) : '', 'td', { alignment: 'right' }),
                  ]),
                ],
              },
              layout: boxedLayout,
            },
            10,
          ),
        ]

  const hasMensajeria =
    cheques?.mensajeria?.mensajeGeneral?.length || cheques?.mensajeria?.mensajesPersonalizados?.length

  // Mostramos todos los mensajes de la API (generales + personalizados)
  // como texto plano al final, sin recuadros ni títulos.
  const inlineMessages: string[] = hasMensajeria
    ? [
        ...(cheques?.mensajeria?.mensajeGeneral ?? []),
        ...(cheques?.mensajeria?.mensajesPersonalizados ?? []),
      ]
        .map((message) => String(message ?? '').trimEnd())
        .filter((message) => message.length > 0)
    : []

  const legalInline: Content[] = inlineMessages.length
    ? [
        boxedBlock(
          {
            stack: [
              { text: inlineMessages.join('\n\n'), style: 'legalInline', margin: [0, 0, 0, 0] },
            ],
          },
          0,
        ),
      ]
    : []

  return [headerBlock, liquidosBlock, ...secuenciaBlocks, ...legalInline]
}

// Nuevo requerimiento: generar 1 PDF por agente (descarga múltiple)
export function buildAgentPdfs(
  normalized: NormalizedPayroll,
  chequesByKey?: Record<string, ChequesBundle>,
  selectedAgents?: string[],
  selectedPeriods?: string[],
): AgentPeriodPdf[] {
  const filtered: NormalizedPayroll = {
    ...normalized,
    items: normalized.items.filter(
      (it) =>
        (!selectedAgents || selectedAgents.includes(it.cuil)) &&
        (!selectedPeriods || selectedPeriods.includes(it.periodo)),
    ),
  }

  const { byCuil, orderedCuils } = groupByAgent(filtered)

  // Devolvemos un PDF por combinación (agente, período).
  const out: AgentPeriodPdf[] = []
  for (const cuil of orderedCuils) {
    const items = byCuil[cuil]
    const agentName = normalized.agents.find((a) => a.cuil === cuil)?.nombre ?? ''

    const periods = Array.from(new Set(items.map((it) => it.periodo))).sort()
    for (const p of periods) {
      const pageItems = items.filter((it) => it.periodo === p)
      const key = `${cuil}-${p.replace('-', '')}`
      const content: Content[] = buildReceiptPage({
        documento: cuil,
        periodo: p,
        items: pageItems,
        agentName,
        cheques: chequesByKey?.[key],
      })
      out.push({ cuil, periodo: p, doc: receiptDoc(content) })
    }
  }

  return out
}

// Nuevo requerimiento: generar 1 PDF por período (descarga múltiple)
export function buildPeriodPdfs(
  normalized: NormalizedPayroll,
  chequesByKey?: Record<string, ChequesBundle>,
  selectedAgents?: string[],
  selectedPeriods?: string[],
): PeriodPdf[] {
  const filtered: NormalizedPayroll = {
    ...normalized,
    items: normalized.items.filter(
      (it) =>
        (!selectedAgents || selectedAgents.includes(it.cuil)) &&
        (!selectedPeriods || selectedPeriods.includes(it.periodo)),
    ),
  }

  const { byPeriod, orderedPeriods } = groupByPeriod(filtered)
  return orderedPeriods.map((periodo) => {
    const items = byPeriod[periodo]
    // En modo "por período": un PDF por período, con 1 página por documento.
    const documentos = Array.from(new Set(items.map((it) => it.cuil))).sort()
    const content: Content[] = []
    for (let i = 0; i < documentos.length; i += 1) {
      const docId = documentos[i]
      const pageItems = items.filter((it) => it.cuil === docId)
      const agentName = normalized.agents.find((a) => a.cuil === docId)?.nombre ?? ''
      const key = `${docId}-${periodo.replace('-', '')}`
      content.push(
        ...buildReceiptPage({
          documento: docId,
          periodo,
          items: pageItems,
          agentName,
          cheques: chequesByKey?.[key],
        }),
      )
      if (i < documentos.length - 1) content.push({ text: ' ', pageBreak: 'after' })
    }

    return { periodo, doc: receiptDoc(content) }
  })
}

export function buildPdf(
  mode: GroupMode,
  normalized: NormalizedPayroll,
  selectedAgents?: string[],
  selectedPeriods?: string[],
): TDocumentDefinitions {
  return mode === 'agent'
    ? buildPdfByAgent(normalized, selectedAgents, selectedPeriods)
    : buildPdfByPeriod(normalized, selectedAgents, selectedPeriods)
}

function buildItemsTable(
  items: PayrollItem[],
  headers: [string, string, string],
  row: (it: PayrollItem) => [string, string, { text: string; alignment: 'right' }],
): Content {
  return {
    table: {
      headerRows: 1,
      widths: ['*', '*', 90],
      body: [
        [
          { text: headers[0], style: 'th' },
          { text: headers[1], style: 'th' },
          { text: headers[2], style: 'th', alignment: 'right' },
        ],
        ...items.map(row),
      ],
    },
    layout: 'lightHorizontalLines',
  }
}

function baseDoc(content: Content[]): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageMargins: [40, 45, 40, 45],
    content,
    styles: {
      h1: { fontSize: 16, bold: true, margin: [0, 0, 0, 10] },
      h2: { fontSize: 12, bold: true },
      th: { fontSize: 9, bold: true, color: '#111827' },
      total: { fontSize: 10, bold: true, color: '#111827' },
    },
    defaultStyle: { fontSize: 9 },
  }
}

function receiptDoc(content: Content[]): TDocumentDefinitions {
  const printedDate = formatDateDDMMYYYY(new Date())
  return {
    pageSize: 'A4',
    // Un margen inferior más acotado ayuda a evitar páginas casi vacías.
    pageMargins: [40, 40, 40, 70],
    content,
    // Sin marca de agua (requerimiento).
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 0, 40, 18],
      columns: [
        { text: printedDate, style: 'footer' },
        {
          text: 'Incluye todos los pagos realizados a la fecha para el período seleccionado\n- Documento válido como Recibo de Haberes -',
          style: 'footerCenter',
          alignment: 'center',
        },
        { text: `Pag.${currentPage} de${pageCount}`, style: 'footer', alignment: 'right' },
      ],
    }),
    styles: {
      header: { fontSize: 10.5, bold: true, lineHeight: 1.12 },
      section: { fontSize: 9, bold: true },
      sectionBox: { fontSize: 8.2, bold: true, color: '#111827' },
      sectionBoxCaract: { fontSize: 5.9, bold: true, color: '#111827', lineHeight: 1.05 },
      thSmall: { fontSize: 7.5, bold: true, color: '#111827' },
      thTiny: { fontSize: 7.1, bold: true, color: '#111827' },
      thCaract: { fontSize: 5.7, bold: true, color: '#111827' },
      thData: { fontSize: 8.2, bold: true, color: '#111827' },
      td: { fontSize: 8, color: '#111827' },
      tdTiny: { fontSize: 7.4, color: '#111827' },
      tdCaract: { fontSize: 5.6, color: '#111827' },
      tdData: { fontSize: 8.6, color: '#111827' },
      legal: { fontSize: 7.8, color: '#111827', lineHeight: 1.15 },
      legalInline: { fontSize: 7.2, color: '#111827', lineHeight: 1.15 },
      footer: { fontSize: 7.5, color: '#111827' },
      footerCenter: { fontSize: 7.3, color: '#111827', lineHeight: 1.1 },
    },
    defaultStyle: { fontSize: 8 },
  }
}
