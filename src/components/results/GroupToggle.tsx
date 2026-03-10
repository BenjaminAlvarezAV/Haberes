import type { GroupMode } from '../../types/payroll'

export function GroupToggle({
  value,
  onChange,
}: {
  value: GroupMode
  onChange: (mode: GroupMode) => void
}) {
  const base =
    'inline-flex items-center rounded-md px-3 py-2 text-sm font-medium ring-1 ring-gray-200'
  const on = 'bg-blue-600 text-white ring-blue-600'
  const off = 'bg-white text-gray-900 hover:bg-gray-50'

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Resultados</h3>
        <p className="text-xs text-gray-600">Elegí cómo agrupar la visualización y el PDF.</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-gray-600">Grupo de resultados:</span>
        <div className="flex gap-2">
          <button
            type="button"
            className={`${base} ${value === 'agent' ? on : off}`}
            onClick={() => onChange('agent')}
          >
            Por Agente
          </button>
          <button
            type="button"
            className={`${base} ${value === 'period' ? on : off}`}
            onClick={() => onChange('period')}
          >
            Por Período
          </button>
        </div>
      </div>
    </div>
  )
}
