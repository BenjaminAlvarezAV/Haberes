import type { PayrollItem } from '../../types/payroll'

function formatCurrency(value: number): string {
  return value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
}

export function ResultsTable({ items }: { items: PayrollItem[] }) {
  const total = items.reduce((acc, it) => acc + it.importe, 0)

  return (
    <div className="overflow-auto rounded-lg ring-1 ring-gray-200">
      <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
          <tr>
            <th className="px-3 py-2">CUIL</th>
            <th className="px-3 py-2">Período</th>
            <th className="px-3 py-2">Concepto</th>
            <th className="px-3 py-2 text-right">Importe</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((it, idx) => (
            <tr key={`${it.cuil}-${it.periodo}-${idx}`} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700">
                {it.cuil}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-700">{it.periodo}</td>
              <td className="px-3 py-2 text-gray-900">{it.concepto}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                {formatCurrency(it.importe)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50">
          <tr>
            <td className="px-3 py-2 text-xs font-semibold text-gray-600" colSpan={3}>
              Total sección
            </td>
            <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-gray-900">
              {formatCurrency(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
