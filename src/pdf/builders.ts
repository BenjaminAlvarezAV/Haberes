import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { GroupMode, NormalizedPayroll, PayrollItem } from '../types/payroll'
import { groupByAgent, groupByPeriod } from '../utils/grouping'
import { RECEIPT_FOOTER_TEXT, RECEIPT_HEADER_LINES } from './receiptConstants'

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

function formatDateDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
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
  return { text, style, ...(extra ?? {}) }
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

function buildReceiptPage({
  documento,
  periodo,
  items,
  agentName,
}: {
  documento: string
  periodo: string
  items: PayrollItem[]
  agentName: string
}): Content[] {
  const now = new Date()
  const total = sectionTotal(items)
  const { haberes, descuentos } = splitHaberes(items)

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
            widths: ['*', 60, 70, 35, 95, 70],
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
                cell(agentName || '—', 'tdData'),
                cell('DNI', 'tdData'),
                cell(documento, 'tdData'),
                cell('—', 'tdData'),
                cell('—', 'tdData'),
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
          [
            cell('—', 'td'),
            cell('—', 'td'),
            cell(yyyymm(periodo), 'td'),
            cell(formatDateDDMMYYYY(now), 'td'),
            cell('—', 'td'),
            cell(pesos(total), 'td', { alignment: 'right' }),
          ],
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

  // Bloques intermedios del recibo real (por ahora placeholders, pero con el encuadre correcto).
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
            widths: [75, 80, 75, '*'],
            body: [
              [cell('ESTABLEC.', 'thTiny'), cell('CATEGORIA', 'thTiny'), cell('DESFAVOR.', 'thTiny'), cell('SECCIONES', 'thTiny')],
              [cell('—', 'tdTiny'), cell('—', 'tdTiny'), cell('—', 'tdTiny'), cell('—', 'tdTiny')],
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
              [cell('ES CARCEL', 'thTiny'), cell('DOBLE ESC.', 'thTiny'), cell('TURNOS', 'thTiny'), cell('DIRECCIÓN', 'thTiny')],
              [cell('—', 'tdTiny'), cell('—', 'tdTiny'), cell('—', 'tdTiny'), cell('—', 'tdTiny')],
            ],
          },
          layout: boxedLayout,
          margin: [0, 0, 0, 4],
        },
        {
          table: {
            headerRows: 1,
            widths: [120, '*'],
            body: [
              [cell('NOMBRE DEL ESTABLECIMIENTO', 'thTiny'), cell('VALOR', 'thTiny')],
              [cell('—', 'tdTiny'), cell('—', 'tdTiny')],
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
              [cell('SECUENCIA', 'thTiny'), cell('REVISTA', 'thTiny'), cell('CARGO REAL', 'thTiny'), cell('C.HORARIA', 'thTiny')],
              [cell('—', 'tdTiny'), cell('—', 'tdTiny'), cell('—', 'tdTiny'), cell('—', 'tdTiny')],
            ],
          },
          layout: boxedLayout,
          margin: [0, 0, 0, 4],
        },
        {
          table: {
            headerRows: 1,
            widths: ['*', '*', '*', 75, 95],
            body: [
              [
                cell('APOYO REAL', 'thTiny'),
                cell('CARGO INT.', 'thTiny'),
                cell('APOYO INT.', 'thTiny'),
                cell('PERIODO LIQ.', 'thTiny'),
                cell('ORDEN DE PAGO', 'thTiny'),
              ],
              [
                cell('—', 'tdTiny'),
                cell('—', 'tdTiny'),
                cell('—', 'tdTiny'),
                cell(yyyymm(periodo), 'tdTiny'),
                cell('—', 'tdTiny'),
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
  )

  // Texto legal: al final de cada resumen (página), sin romper el pie de página.
  const legalInline: Content = {
    text: RECEIPT_FOOTER_TEXT,
    style: 'legalInline',
    margin: [0, 2, 0, 0],
  }

  return [headerBlock, liquidosBlock, caracteristicasBlock, secuenciaBlock, conceptosBlock, legalInline]
}

// Nuevo requerimiento: generar 1 PDF por agente (descarga múltiple)
export function buildAgentPdfs(
  normalized: NormalizedPayroll,
  selectedAgents?: string[],
  selectedPeriods?: string[],
): AgentPdf[] {
  const filtered: NormalizedPayroll = {
    ...normalized,
    items: normalized.items.filter(
      (it) =>
        (!selectedAgents || selectedAgents.includes(it.cuil)) &&
        (!selectedPeriods || selectedPeriods.includes(it.periodo)),
    ),
  }

  const { byCuil, orderedCuils } = groupByAgent(filtered)
  return orderedCuils.map((cuil) => {
    const items = byCuil[cuil]
    const agentName = normalized.agents.find((a) => a.cuil === cuil)?.nombre ?? ''

    // En modo "por agente": un PDF por documento, con 1 página por período.
    const periods = Array.from(new Set(items.map((it) => it.periodo))).sort()
    const content: Content[] = []
    for (let i = 0; i < periods.length; i += 1) {
      const p = periods[i]
      const pageItems = items.filter((it) => it.periodo === p)
      content.push(...buildReceiptPage({ documento: cuil, periodo: p, items: pageItems, agentName }))
      if (i < periods.length - 1) content.push({ text: ' ', pageBreak: 'after' })
    }

    return { cuil, doc: receiptDoc(content) }
  })
}

// Nuevo requerimiento: generar 1 PDF por período (descarga múltiple)
export function buildPeriodPdfs(
  normalized: NormalizedPayroll,
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
      content.push(...buildReceiptPage({ documento: docId, periodo, items: pageItems, agentName }))
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
