import { useEffect, useMemo, useState } from 'react'
import { currentPeriod, expandPeriodRange, isFuturePeriod, isValidPeriod } from '../../utils/period'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { DatePicker } from '../ui/DatePicker'

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

function computeRangeSelection(params: {
  from: string
  to: string
  max: string
  availableSorted: string[]
}): { next: string[]; error: string | null } {
  const { from, to, max, availableSorted } = params

  if (!from || !to) return { next: [], error: null }
  if (!isValidPeriod(from) || !isValidPeriod(to)) return { next: [], error: null }

  if (isFuturePeriod(from, max) || isFuturePeriod(to, max)) {
    return { next: [], error: 'No se permiten períodos futuros' }
  }
  if (from > to) {
    return { next: [], error: 'El período DESDE no puede ser mayor que HASTA' }
  }

  const desired = expandPeriodRange(from, to)
  const setAvailable = new Set(availableSorted)
  const next = desired.filter((p) => (availableSorted.length > 0 ? setAvailable.has(p) : true))

  if (next.length === 0) {
    return { next: [], error: 'El rango seleccionado no tiene períodos disponibles en el CSV' }
  }

  return { next, error: null }
}

function periodToInputDate(period: string): string {
  // YYYY-MM -> YYYY-MM-01 (valor válido para <input type="date">)
  if (!isValidPeriod(period)) return ''
  return `${period}-01`
}

function inputDateToPeriod(value: string): string | null {
  // YYYY-MM-DD -> YYYY-MM (ignoramos el día)
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const period = value.slice(0, 7)
  if (!isValidPeriod(period)) return null
  return period
}

function shiftInputYear(value: string, yearsDelta: number): string {
  const safe = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : `${currentPeriod()}-01`
  const [y, m, d] = safe.split('-').map((v) => Number(v))
  const date = new Date(y, m - 1, d)
  date.setFullYear(date.getFullYear() + yearsDelta)
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export function PeriodSelector({
  value,
  available,
  onChange,
}: {
  value: string[]
  available: string[]
  onChange: (periodos: string[]) => void
}) {
  const [useRangeFilter, setUseRangeFilter] = useState(true)
  const [showPeriods, setShowPeriods] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sorted = useMemo(() => [...value].sort(), [value])
  const availableSorted = useMemo(() => [...available].sort(), [available])
  const max = useMemo(() => currentPeriod(), [])

  const remove = (p: string) => onChange(value.filter((x) => x !== p))

  // Defaults amigables cuando llega un CSV nuevo.
  useEffect(() => {
    if (availableSorted.length === 0) return
    setFrom((prev) => prev || periodToInputDate(availableSorted[0]))
    setTo((prev) => prev || periodToInputDate(availableSorted[availableSorted.length - 1]))
  }, [availableSorted])

  // Aplicación automática del rango (sin necesidad de click).
  useEffect(() => {
    if (!useRangeFilter) return
    if (!from || !to) {
      setError(null)
      return
    }
    const fromPeriod = inputDateToPeriod(from)
    const toPeriod = inputDateToPeriod(to)
    if (!fromPeriod || !toPeriod) {
      setError('Formato de fecha inválido.')
      onChange([])
      return
    }

    const handle = window.setTimeout(() => {
      const computed = computeRangeSelection({ from: fromPeriod, to: toPeriod, max, availableSorted })
      if (computed.error) {
        setError(computed.error)
        if (computed.next.length === 0 && value.length !== 0) onChange([])
        return
      }

      setError(null)
      const sortedNext = [...computed.next].sort()
      const sortedCurrent = [...value].sort()
      if (!arraysEqual(sortedNext, sortedCurrent)) onChange(sortedNext)
    }, 200)

    return () => window.clearTimeout(handle)
  }, [from, to, availableSorted, max, onChange, useRangeFilter, value])

  // Si el usuario apaga el filtro por rango, seleccionamos automáticamente "todos los períodos del CSV".
  useEffect(() => {
    if (availableSorted.length === 0) return
    if (useRangeFilter) return

    setError(null)
    const sortedCurrent = [...value].sort()
    const sortedAll = [...availableSorted].sort()
    if (!arraysEqual(sortedCurrent, sortedAll)) onChange(sortedAll)
  }, [availableSorted, onChange, useRangeFilter, value])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-gray-900 select-none">
          <input
            type="checkbox"
            className="h-4 w-4 accent-blue-600"
            checked={useRangeFilter}
            onChange={(e) => {
              const next = e.target.checked
              setUseRangeFilter(next)
              setError(null)

              if (!availableSorted.length) return

              if (!next) {
                // Apagado: todos los períodos.
                onChange(availableSorted)
              } else {
                // Encendido: aplicamos el rango actual (o el default si está vacío).
                const nextFromInput = from || periodToInputDate(availableSorted[0])
                const nextToInput = to || periodToInputDate(availableSorted[availableSorted.length - 1])
                setFrom(nextFromInput)
                setTo(nextToInput)

                const fromPeriod = inputDateToPeriod(nextFromInput)
                const toPeriod = inputDateToPeriod(nextToInput)

                if (!fromPeriod || !toPeriod) {
                  setError('Formato de fecha inválido.')
                  onChange([])
                  return
                }

                const computed = computeRangeSelection({
                  from: fromPeriod,
                  to: toPeriod,
                  max,
                  availableSorted,
                })
                if (computed.error) {
                  setError(computed.error)
                  onChange([])
                } else {
                  onChange([...computed.next].sort())
                }
              }
            }}
          />
          Filtrar por rango de períodos
        </label>
      </div>

      {useRangeFilter ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto] items-end">
          <div>
            <label className="block text-sm font-medium text-gray-900">Desde (mm/aaaa)</label>
            <div className="mt-1">
              <DatePicker
                value={from}
                onChange={(next) => setFrom(next)}
                max={periodToInputDate(max)}
                placeholder="mm/aaaa"
                className="w-full"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900">Hasta (mm/aaaa)</label>
            <div className="mt-1">
              <DatePicker
                value={to}
                onChange={(next) => setTo(next)}
                max={periodToInputDate(max)}
                placeholder="mm/aaaa"
                className="w-full"
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-600">
          Disponibles en CSV: <span className="font-medium">{availableSorted.length}</span> — Seleccionados:{' '}
          <span className="font-medium">{sorted.length}</span>
        </p>
        <Button
          type="button"
          variant="secondary"
          className="h-8 px-2 text-xs"
          onClick={() => setShowPeriods((v) => !v)}
          disabled={sorted.length === 0}
        >
          {showPeriods ? 'Ocultar períodos' : 'Mostrar períodos'}
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {sorted.length > 0 && showPeriods ? (
        // Si hay muchas filas, el contenedor queda scrolleable y no estira la página.
        <div className="max-h-[220px] overflow-y-auto pr-1">
          <div className="flex flex-wrap gap-2">
            {sorted.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-900 ring-1 ring-gray-200"
              >
                {p}
                {useRangeFilter ? (
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    className="rounded-full px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200"
                    aria-label={`Quitar período ${p}`}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-600">
          {sorted.length > 0
            ? 'Mostrando todos los períodos del CSV.'
            : 'Sin períodos seleccionados.'}
        </p>
      )}
    </div>
  )
}
