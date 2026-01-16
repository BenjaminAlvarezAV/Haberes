import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { GroupMode, NormalizedPayroll, PayrollItem } from '../types/payroll'
import { groupByAgent, groupByPeriod } from '../utils/grouping'

function money(value: number): string {
  return value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
}

function sectionTotal(items: PayrollItem[]): number {
  return items.reduce((acc, it) => acc + it.importe, 0)
}

export function buildPdfByAgent(
  normalized: NormalizedPayroll,
  selectedAgents?: string[],
  selectedPeriods?: string[],
): TDocumentDefinitions {
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
        { text: money(it.importe), alignment: 'right' },
      ]),
    )
    content.push({
      text: `Total agente: ${money(sectionTotal(items))}`,
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
        { text: money(it.importe), alignment: 'right' },
      ]),
    )
    content.push({
      text: `Total período: ${money(sectionTotal(items))}`,
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
    const content: Content[] = [{ text: `Haberes - Período ${periodo}`, style: 'h1' }]
    content.push(
      buildItemsTable(items, ['Documento', 'Concepto', 'Importe'], (it) => [
        it.cuil,
        it.concepto,
        { text: money(it.importe), alignment: 'right' },
      ]),
    )
    content.push({
      text: `Total período: ${money(sectionTotal(items))}`,
      style: 'total',
      margin: [0, 6, 0, 0],
    })

    return { periodo, doc: baseDoc(content) }
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
