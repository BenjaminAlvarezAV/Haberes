import { useMemo, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { CuilUploader } from '../../components/upload/CuilUploader'
import { PeriodSelector } from '../../components/filters/PeriodSelector'
import { GroupToggle } from '../../components/results/GroupToggle'
import { ResultsTable } from '../../components/results/ResultsTable'
import { PdfPreviewModal } from '../../components/pdf/PdfPreviewModal'
import { usePayroll } from '../../hooks/usePayroll'
import { buildPdf } from '../../pdf/builders'
import { groupByAgent, groupByPeriod } from '../../utils/grouping'

export function PayrollPage() {
  const { cuils, periodos, groupMode, loading, error, data, dispatch, consult, lastUploadReport } =
    usePayroll()

  const [pdfOpen, setPdfOpen] = useState(false)

  const pdfDoc = useMemo(() => (data ? buildPdf(groupMode, data) : null), [data, groupMode])

  const grouped = useMemo(() => {
    if (!data) return null
    return groupMode === 'agent' ? groupByAgent(data) : groupByPeriod(data)
  }, [data, groupMode])

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-gray-900">
            Sistema de Consulta de Haberes Docentes
          </h1>
          <p className="text-sm text-gray-600">
            Cargá una nómina (TXT), elegí período(s) y consultá liquidaciones para generar PDFs.
          </p>
        </header>

        <Card title="Entrada de datos">
          <div className="grid gap-6 lg:grid-cols-2">
            <CuilUploader
              onCuilsParsed={(nextCuils, report) => {
                // Paso 6: verificación rápida
                console.log('CUILs leídos:', nextCuils)
                dispatch({ type: 'SET_CUILS', payload: { cuils: nextCuils, report } })
              }}
            />

            <div className="space-y-4">
              <PeriodSelector
                value={periodos}
                onChange={(next) => dispatch({ type: 'SET_PERIODOS', payload: next })}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => void consult()} disabled={loading}>
                  {loading ? 'Consultando…' : 'Consultar'}
                </Button>
                <div className="text-sm text-gray-700">
                  <span className="font-medium">{cuils.length}</span> CUILs ·{' '}
                  <span className="font-medium">{periodos.length}</span> período(s)
                </div>
              </div>

              {lastUploadReport ? (
                <p className="text-xs text-gray-600">
                  Última nómina: {lastUploadReport.valid} válidos, {lastUploadReport.invalid}{' '}
                  inválidos,
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

              {data.errors && data.errors.length > 0 ? (
                <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
                  Se detectaron {data.errors.length} observaciones al normalizar la respuesta.
                </div>
              ) : null}

              {groupMode === 'agent' && grouped ? (
                <div className="space-y-6">
                  {grouped.orderedCuils.map((cuil) => (
                    <div key={cuil} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-gray-900">Agente {cuil}</h4>
                        <span className="text-xs text-gray-600">
                          {grouped.byCuil[cuil].length} ítems
                        </span>
                      </div>
                      <ResultsTable items={grouped.byCuil[cuil]} />
                    </div>
                  ))}
                </div>
              ) : null}

              {groupMode === 'period' && grouped ? (
                <div className="space-y-6">
                  {grouped.orderedPeriods.map((period) => (
                    <div key={period} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-gray-900">Período {period}</h4>
                        <span className="text-xs text-gray-600">
                          {grouped.byPeriod[period].length} ítems
                        </span>
                      </div>
                      <ResultsTable items={grouped.byPeriod[period]} />
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => setPdfOpen(true)}
                  disabled={!pdfDoc || data.items.length === 0}
                >
                  Vista previa PDF
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {pdfOpen && pdfDoc ? (
          <PdfPreviewModal
            doc={pdfDoc}
            filename={`haberes-${groupMode}.pdf`}
            onClose={() => setPdfOpen(false)}
          />
        ) : null}
      </div>
    </div>
  )
}
