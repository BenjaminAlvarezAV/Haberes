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
  const [useRangeFilter, setUseRangeFilter] = useState(false)
  const [showPeriods, setShowPeriods] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [singlePeriod, setSinglePeriod] = useState<string>('') // YYYY-MM

  const sorted = useMemo(() => [...value].sort(), [value])
  const availableSorted = useMemo(() => [...available].sort(), [available])
  const max = useMemo(() => currentPeriod(), [])

  const remove = (p: string) => onChange(value.filter((x) => x !== p))

  // Defaults amigables cuando llega un CSV nuevo (solo para rango, no modifican la selección).
  useEffect(() => {
    if (availableSorted.length === 0) return
    // Para rango, inicializamos desde/hasta con el primer y último período disponible.
    setFrom((prev) => prev || periodToInputDate(availableSorted[0]))
    setTo((prev) => prev || periodToInputDate(availableSorted[availableSorted.length - 1]))
    // Para período único, si aún no hay ninguno elegido, usamos el más reciente.
    setSinglePeriod((prev) => (prev && isValidPeriod(prev) ? prev : availableSorted[availableSorted.length - 1]))
  }, [availableSorted])

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
                // Apagado: modo "períodos individuales". Mantenemos la selección actual;
                // el usuario podrá agregar períodos puntuales con el campo de abajo.
                const base =
                  singlePeriod && isValidPeriod(singlePeriod)
                    ? singlePeriod
                    : availableSorted[availableSorted.length - 1]
                setSinglePeriod(base)
              } else {
                // Encendido: dejamos preparados los valores de rango actuales o defaults,
                // pero la aplicación del rango se hace con el botón "Agregar períodos del rango".
                const nextFromInput = from || periodToInputDate(availableSorted[0])
                const nextToInput = to || periodToInputDate(availableSorted[availableSorted.length - 1])
                setFrom(nextFromInput)
                setTo(nextToInput)
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
          <Button
            type="button"
            className="h-10 whitespace-nowrap text-xs"
            variant="secondary"
            onClick={() => {
              const fromPeriod = inputDateToPeriod(from)
              const toPeriod = inputDateToPeriod(to)
              if (!fromPeriod || !toPeriod || !isValidPeriod(fromPeriod) || !isValidPeriod(toPeriod)) {
                setError('Ingresá un rango válido en formato mm/aaaa.')
                return
              }
              const computed = computeRangeSelection({ from: fromPeriod, to: toPeriod, max, availableSorted })
              if (computed.error) {
                setError(computed.error)
                return
              }
              setError(null)
              const nextSet = new Set([...value, ...computed.next])
              const nextList = Array.from(nextSet).sort()
              if (!arraysEqual(nextList, [...value].sort())) {
                onChange(nextList)
              }
            }}
          >
            Agregar períodos del rango
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] items-end">
          <div>
            <label className="block text-sm font-medium text-gray-900">Período único (mm/aaaa)</label>
            <div className="mt-1">
              <DatePicker
                value={singlePeriod ? `${singlePeriod}-01` : ''}
                onChange={(next) => {
                  const period = inputDateToPeriod(next)
                  if (!period || !isValidPeriod(period)) {
                    setError('Formato de período inválido.')
                    setSinglePeriod('')
                    return
                  }
                  setError(null)
                  setSinglePeriod(period)
                }}
                max={periodToInputDate(max)}
                placeholder="mm/aaaa"
                className="w-full"
              />
            </div>
          </div>
          <Button
            type="button"
            className="h-10 whitespace-nowrap text-xs"
            variant="secondary"
            disabled={!singlePeriod}
            onClick={() => {
              if (!singlePeriod || !isValidPeriod(singlePeriod)) {
                setError('Ingresá un período válido en formato mm/aaaa.')
                return
              }
              if (isFuturePeriod(singlePeriod, max)) {
                setError('No se permiten períodos futuros')
                return
              }
              if (availableSorted.length > 0 && !availableSorted.includes(singlePeriod)) {
                setError('El período ingresado no está disponible en los CSV cargados')
                return
              }

              setError(null)
              const nextSet = new Set([...value, singlePeriod])
              const nextList = Array.from(nextSet).sort()
              if (!arraysEqual(nextList, [...value].sort())) {
                onChange(nextList)
              }
            }}
          >
            Agregar período
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-600">
          Disponibles en CSV: <span className="font-medium">{availableSorted.length}</span> — Seleccionados:{' '}
          <span className="font-medium">{sorted.length}</span>
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2 text-xs"
            onClick={() => {
              setError(null)
              if (value.length > 0) onChange([])
            }}
            disabled={sorted.length === 0}
          >
            Limpiar períodos
          </Button>
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
