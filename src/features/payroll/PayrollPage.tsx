import { useCallback, useMemo, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { CuilUploader, type SercopeUploadPayload } from '../../components/upload/CuilUploader'
import { PeriodSelector } from '../../components/filters/PeriodSelector'
import { GroupToggle } from '../../components/results/GroupToggle'
import { ResultsTable } from '../../components/results/ResultsTable'
import { PdfPreviewModal } from '../../components/pdf/PdfPreviewModal'
import { usePayroll } from '../../hooks/usePayroll'
import { buildPeriodPdfs } from '../../pdf/builders'
import { downloadPdf } from '../../pdf/render'
import { groupByAgent, groupByPeriod } from '../../utils/grouping'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

  const grouped = useMemo(() => {
    if (!data) return null
    return groupMode === 'agent' ? groupByAgent(data) : groupByPeriod(data)
  }, [data, groupMode])

  const periodPdfs = useMemo(() => (data ? buildPeriodPdfs(data) : []), [data])
  const preview = periodPdfs[0] ?? null

  const onCsvParsed = useCallback(
    (payload: SercopeUploadPayload) => {
      // Guardamos documentos en el estado (reutilizamos cuils como identificador)
      dispatch({ type: 'SET_CUILS', payload: { cuils: payload.documentos, report: payload.report } })
      // Derivamos períodos del CSV y los seteamos (editable desde el selector)
      dispatch({ type: 'SET_PERIODOS', payload: payload.periodos })
    },
    [dispatch],
  )

  const downloadAllPdfs = useCallback(async () => {
    if (!data) return

    const docs = buildPeriodPdfs(data)
    if (docs.length === 0) return

    // Disparar múltiples descargas desde un solo click puede ser bloqueado por algunos browsers.
    // Lo hacemos secuencial con una pausa mínima.
    for (const d of docs) {
      downloadPdf(d.doc, `haberes-${d.periodo}.pdf`)
      await sleep(150)
    }
  }, [data])

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
                        <span className="text-xs text-gray-600">{grouped.byCuil[cuil].length} ítems</span>
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
                        <span className="text-xs text-gray-600">{grouped.byPeriod[period].length} ítems</span>
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
                  disabled={!preview || (data.items?.length ?? 0) === 0}
                >
                  Vista previa PDF (primer período)
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void downloadAllPdfs()}
                  disabled={periodPdfs.length === 0}
                >
                  Descargar PDFs (1 por período)
                </Button>
                <span className="text-xs text-gray-600 self-center">
                  {periodPdfs.length} PDF(s)
                </span>
              </div>
            </div>
          </Card>
        ) : null}

        {pdfOpen && preview ? (
          <PdfPreviewModal
            doc={preview.doc}
            filename={`haberes-${preview.periodo}.pdf`}
            onClose={() => setPdfOpen(false)}
          />
        ) : null}
      </div>
    </div>
  )
}
