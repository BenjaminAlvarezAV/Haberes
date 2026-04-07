import type { GroupMode } from '../../types/payroll'

export function GroupToggle({
  value,
  onChange,
}: {
  value: GroupMode
  onChange: (mode: GroupMode) => void
}) {
  const base =
    'inline-flex items-center rounded-md px-3 py-2 text-sm font-medium ring-1 ring-outline-variant'
  const on = 'bg-primary text-on-primary ring-primary'
  const off = 'bg-surface text-on-surface hover:bg-table-hover'

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-on-surface">Resultados</h3>
        <p className="text-xs text-on-surface-variant">Elegí cómo agrupar la visualización y el PDF.</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-on-surface-variant">Grupo de resultados:</span>
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
