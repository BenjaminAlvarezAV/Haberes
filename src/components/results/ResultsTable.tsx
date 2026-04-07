import type { PayrollItem } from '../../types/payroll'
import { Fragment } from 'react'

function formatCurrency(value: number): string {
  return value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
}

/** En vista por agente, separar bloques por período. En vista por período, por agente (CUIL). */
export type ResultsSeparatorBy = 'period' | 'agent'

export function ResultsTable({
  items,
  separatorBy = 'period',
}: {
  items: PayrollItem[]
  separatorBy?: ResultsSeparatorBy
}) {
  const sorted = [...items].sort((a, b) => {
    if (separatorBy === 'agent') {
      if (a.cuil !== b.cuil) return a.cuil.localeCompare(b.cuil)
      return a.concepto.localeCompare(b.concepto)
    }
    if (a.periodo !== b.periodo) return a.periodo.localeCompare(b.periodo)
    if (a.cuil !== b.cuil) return a.cuil.localeCompare(b.cuil)
    return a.concepto.localeCompare(b.concepto)
  })

  const total = sorted.reduce((acc, it) => acc + it.importe, 0)

  return (
    <div className="overflow-auto rounded-lg ring-1 ring-outline-variant">
      <table className="min-w-full divide-y divide-table-divide bg-surface text-sm">
        <thead className="bg-surface-tonal text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
          <tr>
            <th className="px-3 py-2">CUIL</th>
            <th className="px-3 py-2">Período</th>
            <th className="px-3 py-2">Concepto</th>
            <th className="px-3 py-2 text-right">Importe</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-table-divide">
          {sorted.map((it, idx) => {
            const prev = idx > 0 ? sorted[idx - 1] : null
            const showSeparator =
              separatorBy === 'agent'
                ? idx === 0 || (prev && prev.cuil !== it.cuil)
                : idx === 0 || (prev && prev.periodo !== it.periodo)

            const separatorLabel =
              separatorBy === 'agent' ? `Agente ${it.cuil}` : `Período ${it.periodo}`

            return (
              <Fragment key={`${it.cuil}-${it.periodo}-${idx}`}>
                {showSeparator ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="bg-surface-tonal px-3 py-1 text-xs font-semibold uppercase tracking-wide text-on-surface"
                    >
                      {separatorLabel}
                    </td>
                  </tr>
                ) : null}
                <tr className="hover:bg-table-hover">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-on-surface-variant">
                    {it.cuil}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-on-surface-variant">{it.periodo}</td>
                  <td className="px-3 py-2 text-on-surface">{it.concepto}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-on-surface">
                    {formatCurrency(it.importe)}
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
        <tfoot className="bg-surface-tonal">
          <tr>
            <td className="px-3 py-2 text-xs font-semibold text-on-surface-variant" colSpan={3}>
              Total sección
            </td>
            <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-on-surface">
              {formatCurrency(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
