import { useMemo, useState } from 'react'
import { isValidPeriod } from '../../utils/period'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

export function PeriodSelector({
  value,
  onChange,
}: {
  value: string[]
  onChange: (periodos: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  const sorted = useMemo(() => [...value].sort(), [value])

  const add = (p: string) => {
    if (!isValidPeriod(p)) return
    if (value.includes(p)) return
    onChange([...value, p])
  }

  const remove = (p: string) => onChange(value.filter((x) => x !== p))

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-900">Períodos (YYYY-MM)</label>
          <div className="mt-1">
            <Input
              type="month"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Seleccionar período"
            />
          </div>
          <p className="mt-1 text-xs text-gray-600">Podés agregar uno o más períodos.</p>
        </div>
        <Button
          type="button"
          onClick={() => {
            if (!draft) return
            add(draft)
            setDraft('')
          }}
          variant="secondary"
        >
          Agregar
        </Button>
      </div>

      {sorted.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {sorted.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-900 ring-1 ring-gray-200"
            >
              {p}
              <button
                type="button"
                onClick={() => remove(p)}
                className="rounded-full px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200"
                aria-label={`Quitar período ${p}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-600">Sin períodos seleccionados.</p>
      )}
    </div>
  )
}
