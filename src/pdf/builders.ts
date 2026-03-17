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

function sumLiquid(rows: LiquidPorEstablecimientoItem[]): number {
  return rows.reduce((acc, r) => acc + (r.liquido ?? 0), 0)
}

function groupCodes(items: LiquidacionPorSecuenciaItem[]): Array<{ codigo: string; desc: string; amount: number }> {
  const map = new Map<string, { codigo: string; desc: string; amount: number }>()
  for (const it of items) {
    const codigo = it.codigo ?? ''
    const desc = it.descripcionCodigo ?? 'Sin descripción'
    const amount = it.pesos ?? 0
    const key = `${codigo}||${desc}`
    const prev = map.get(key)
    if (prev) prev.amount += amount
    else map.set(key, { codigo, desc, amount })
  }
  return Array.from(map.values()).sort((a, b) => a.codigo.localeCompare(b.codigo))
}

function yesNoFromFlag(value: string | null): string {
  if (!value) return '—'
  const v = String(value).trim().toLowerCase()
  if (v === 's' || v === 'si' || v === 'sí' || v === 'y' || v === 'yes' || v === 'true' || v === '1') return 'S'
  if (v === 'n' || v === 'no' || v === 'false' || v === '0') return 'N'
  return value
}

type SecuenciaGroup = {
  key: string
  meta: {
    estabCode: string
    nombreEstab: string
    categoria: string
    desfavor: string
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
    periodoLiq: string
    ordenPago: string
    direccion: string
  }
  items: LiquidacionPorSecuenciaItem[]
}

function groupBySecuencia(items: LiquidacionPorSecuenciaItem[], fallbackPeriodo: string): SecuenciaGroup[] {
  const map = new Map<string, SecuenciaGroup>()

  for (const it of items) {
    const tipoOrg = (it.tipoOrg ?? '').trim()
    const numero = (it.numero ?? '').trim()
    const secu = (it.secu ?? '').trim()
    const nombreEstab = (it.nombreEstab ?? '').trim()
    const rev = (it.rev ?? '').trim()
    const oPid = (it.oPid ?? '').trim()
    const periodoLiq = yyyymmToPeriod(it.mesaPago)?.trim() || yyyymmToPeriod(it.fecAfec)?.trim() || fallbackPeriodo

    const estabCode = tipoOrg && numero ? `${tipoOrg}-${numero}` : '—'
    const key = [estabCode, secu, rev, oPid, periodoLiq, nombreEstab].join('|')

    if (!map.has(key)) {
      map.set(key, {
        key,
        meta: {
          estabCode,
          nombreEstab: nombreEstab || '—',
          categoria: it.cat ?? '—',
          desfavor: yesNoFromFlag(it.rural),
          secciones: it.secciones ?? '—',
          esCarcel: yesNoFromFlag(it.esCarcel),
          dobleEscol: yesNoFromFlag(it.dobEscolEstab),
          turnos: it.turnos ?? '—',
          secuencia: secu || '—',
          revista: rev || '—',
          cargoReal: it.cargoReal ?? '—',
          choraria: it.choraria ?? '—',
          apoyoReal: it.apoyoReal ?? '—',
          cargoInt: it.cargoInt ?? '—',
          apoyoInt: it.apoyoInt ?? '—',
          periodoLiq: mesPago(periodoLiq),
          ordenPago: oPid ? `ORDEN DE PAGO: ${oPid}` : '—',
          direccion: it.direccion ?? '—',
        },
        items: [],
      })
    }

    map.get(key)!.items.push(it)
  }

  // Orden estable: por estabCode, secuencia, revista
  return Array.from(map.values()).sort((a, b) => {
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

const boxedLayout = {
  hLineWidth: () => 0.8,
  vLineWidth: () => 0.8,
  hLineColor: () => '#111827',
  vLineColor: () => '#111827',
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 2.5,
  paddingBottom: () => 2.5,
}

const boxedLayoutRoomy = {
  ...boxedLayout,
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 4,
  paddingBottom: () => 4,
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
  const total = cheques?.liquidPorEstablecimiento?.length
    ? sumLiquid(cheques.liquidPorEstablecimiento)
    : sectionTotal(items)
  const { haberes, descuentos } = splitHaberes(items)

  const head = cheques?.liquidacionPorSecuencia?.[0]
  const nombre = head?.apYNom ?? agentName
  const sexo = head?.sexo ?? '—'
  const cuitCuil = head?.cuitCuil ? head.cuitCuil : '—'

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
          ...(cheques?.liquidPorEstablecimiento?.length
            ? cheques.liquidPorEstablecimiento.map((r) => [
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

  const secuGroups: SecuenciaGroup[] =
    cheques?.liquidacionPorSecuencia?.length
      ? groupBySecuencia(cheques.liquidacionPorSecuencia, periodo)
      : []

  const secuenciaBlocks: Content[] =
    secuGroups.length > 0
      ? secuGroups.flatMap((g) => {
          const caracteristicasBlock = boxedBlock(
            {
              stack: [
                {
                  table: {
                    widths: ['*'],
                    body: [[cell('CARACTERISTICAS DEL ESTABLECIMIENTO', 'sectionBox', { fillColor: '#f9fafb' })]],
                  },
                  layout: boxedLayout,
                  margin: [0, 0, 0, 4],
                },
                {
                  table: {
                    headerRows: 1,
                    widths: [95, 70, 75, '*'],
                    body: [
                      [
                        cell('ESTABLEC.', 'thTiny'),
                        cell('CATEGORIA', 'thTiny'),
                        cell('DESFAVOR.', 'thTiny'),
                        cell('SECCIONES', 'thTiny'),
                      ],
                      [
                        cell(g.meta.estabCode, 'tdTiny'),
                        cell(g.meta.categoria, 'tdTiny'),
                        cell(g.meta.desfavor, 'tdTiny'),
                        cell(g.meta.secciones, 'tdTiny'),
                      ],
                    ],
                  },
                  layout: boxedLayout,
                  margin: [0, 0, 0, 4],
                },
                {
                  table: {
                    headerRows: 1,
                    widths: [70, 75, 60, '*'],
                    body: [
                      [
                        cell('ES CARCEL', 'thTiny'),
                        cell('DOBLE ESC.', 'thTiny'),
                        cell('TURNOS', 'thTiny'),
                        cell('DIRECCIÓN', 'thTiny'),
                      ],
                      [
                        cell(g.meta.esCarcel, 'tdTiny'),
                        cell(g.meta.dobleEscol, 'tdTiny'),
                        cell(g.meta.turnos, 'tdTiny'),
                        cell(g.meta.direccion, 'tdTiny'),
                      ],
                    ],
                  },
                  layout: boxedLayout,
                  margin: [0, 0, 0, 4],
                },
                {
                  table: {
                    headerRows: 1,
                    widths: [160, '*'],
                    body: [
                      [cell('NOMBRE DEL ESTABLECIMIENTO', 'thTiny'), cell('VALOR', 'thTiny')],
                      [cell(g.meta.nombreEstab, 'tdTiny'), cell('—', 'tdTiny')],
                    ],
                  },
                  layout: boxedLayout,
                },
              ],
            },
            8,
          )

          const secuenciaBlock = boxedBlock(
            {
              stack: [
                {
                  table: {
                    widths: ['*'],
                    body: [[cell('SECUENCIA / DATOS DEL CARGO', 'sectionBox', { fillColor: '#f9fafb' })]],
                  },
                  layout: boxedLayout,
                  margin: [0, 0, 0, 4],
                },
                {
                  table: {
                    headerRows: 1,
                    widths: [70, 70, '*', 70],
                    body: [
                      [
                        cell('SECUENCIA', 'thTiny'),
                        cell('REVISTA', 'thTiny'),
                        cell('CARGO REAL', 'thTiny'),
                        cell('C.HORARIA', 'thTiny'),
                      ],
                      [
                        cell(g.meta.secuencia, 'tdTiny'),
                        cell(g.meta.revista, 'tdTiny'),
                        cell(g.meta.cargoReal, 'tdTiny'),
                        cell(g.meta.choraria, 'tdTiny'),
                      ],
                    ],
                  },
                  layout: boxedLayout,
                  margin: [0, 0, 0, 4],
                },
                {
                  table: {
                    headerRows: 1,
                    widths: ['*', '*', '*', 75, 120],
                    body: [
                      [
                        cell('APOYO REAL', 'thTiny'),
                        cell('CARGO INT.', 'thTiny'),
                        cell('APOYO INT.', 'thTiny'),
                        cell('PERIODO LIQ.', 'thTiny'),
                        cell('ORDEN DE PAGO', 'thTiny'),
                      ],
                      [
                        cell(g.meta.apoyoReal, 'tdTiny'),
                        cell(g.meta.cargoInt, 'tdTiny'),
                        cell(g.meta.apoyoInt, 'tdTiny'),
                        cell(g.meta.periodoLiq, 'tdTiny'),
                        cell(g.meta.ordenPago, 'tdTiny'),
                      ],
                    ],
                  },
                  layout: boxedLayout,
                },
              ],
            },
            8,
          )

          const conceptosBlock = boxedBlock(
            {
              table: {
                headerRows: 1,
                widths: [55, '*', 80, 80],
                body: [
                  [
                    cell('COD', 'thSmall'),
                    cell('HABERES', 'thSmall'),
                    cell('Haberes', 'thSmall', { alignment: 'right' }),
                    cell('Descuentos', 'thSmall', { alignment: 'right' }),
                  ],
                  ...groupCodes(g.items).map((c) => [
                    cell(c.codigo || '', 'td'),
                    cell(c.desc, 'td'),
                    cell(c.amount >= 0 ? pesos(c.amount) : '', 'td', { alignment: 'right' }),
                    cell(c.amount < 0 ? pesos(c.amount) : '', 'td', { alignment: 'right' }),
                  ]),
                ],
              },
              layout: boxedLayout,
            },
            10,
          )

          return [
            {
              stack: [caracteristicasBlock, secuenciaBlock, conceptosBlock],
              unbreakable: true,
            },
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
    : []

  const legalInline: Content[] = inlineMessages.length
    ? [{ text: inlineMessages.join('\n\n'), style: 'legalInline', margin: [0, 2, 0, 0] }]
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
    // Reservamos espacio para que el texto legal no pise el pie de página.
    pageMargins: [40, 40, 40, 90],
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
      thSmall: { fontSize: 7.5, bold: true, color: '#111827' },
      thTiny: { fontSize: 7.1, bold: true, color: '#111827' },
      thData: { fontSize: 8.2, bold: true, color: '#111827' },
      td: { fontSize: 8, color: '#111827' },
      tdTiny: { fontSize: 7.4, color: '#111827' },
      tdData: { fontSize: 8.6, color: '#111827' },
      legal: { fontSize: 7.8, color: '#111827', lineHeight: 1.15 },
      legalInline: { fontSize: 6.4, color: '#111827', lineHeight: 1.05 },
      footer: { fontSize: 7.5, color: '#111827' },
      footerCenter: { fontSize: 7.3, color: '#111827', lineHeight: 1.1 },
    },
    defaultStyle: { fontSize: 8 },
  }
}
