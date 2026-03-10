import { useEffect, useMemo, useState } from 'react'
import { currentPeriod, expandPeriodRange, isFuturePeriod, isValidPeriod } from '../../utils/period'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

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
    setFrom((prev) => prev || availableSorted[0])
    setTo((prev) => prev || availableSorted[availableSorted.length - 1])
  }, [availableSorted])

  // Aplicación automática del rango (sin necesidad de click).
  useEffect(() => {
    if (!useRangeFilter) return
    if (!from || !to) return
    if (!isValidPeriod(from) || !isValidPeriod(to)) return

    const handle = window.setTimeout(() => {
      const computed = computeRangeSelection({ from, to, max, availableSorted })
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
  }, [from, to, availableSorted, max, onChange, value])

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
                const nextFrom = from || availableSorted[0]
                const nextTo = to || availableSorted[availableSorted.length - 1]
                setFrom(nextFrom)
                setTo(nextTo)

                const computed = computeRangeSelection({
                  from: nextFrom,
                  to: nextTo,
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

        <Button
          type="button"
          onClick={() => {
            setError(null)
            setUseRangeFilter(false)
            if (availableSorted.length > 0) onChange(availableSorted)
          }}
          variant="secondary"
          className="h-10 whitespace-nowrap"
          disabled={availableSorted.length === 0}
        >
          Ver todos
        </Button>
      </div>

      {useRangeFilter ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto] items-end">
          <div>
            <label className="block text-sm font-medium text-gray-900">Desde (YYYY-MM)</label>
            <div className="mt-1">
              <Input type="month" value={from} onChange={(e) => setFrom(e.target.value)} max={max} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900">Hasta (YYYY-MM)</label>
            <div className="mt-1">
              <Input type="month" value={to} onChange={(e) => setTo(e.target.value)} max={max} />
            </div>
          </div>
          <Button
            type="button"
            onClick={() => {
              setError(null)
              if (availableSorted.length > 0) {
                setFrom(availableSorted[0])
                setTo(availableSorted[availableSorted.length - 1])
              }
              onChange(availableSorted)
              setUseRangeFilter(false)
            }}
            variant="secondary"
            className="h-10 whitespace-nowrap"
            disabled={availableSorted.length === 0}
          >
            Todos
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-600">
          Disponibles en CSV: <span className="font-medium">{availableSorted.length}</span> — Seleccionados:{' '}
          <span className="font-medium">{sorted.length}</span> (máximo {max})
        </p>
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-2 text-xs ring-1 ring-gray-200"
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
