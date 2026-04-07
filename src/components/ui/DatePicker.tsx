import { useEffect, useMemo, useRef, useState } from 'react'

type DatePickerProps = {
  value: string
  onChange: (next: string) => void
  min?: string
  max?: string
  placeholder?: string
  className?: string
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(year, month - 1, day)
}

/** Años en UI: sin futuros; hasta 20 años atrás; recortado por min/max. */
const YEARS_BACK = 20

function yearBounds(min?: string, max?: string): { yearLow: number; yearHigh: number } {
  const thisYear = new Date().getFullYear()
  const minParsed = parseDate(min)
  const maxParsed = parseDate(max)
  let yearLow = thisYear - YEARS_BACK
  if (minParsed) yearLow = Math.max(yearLow, minParsed.getFullYear())
  let yearHigh = thisYear
  if (maxParsed) yearHigh = Math.min(yearHigh, maxParsed.getFullYear())
  if (yearLow > yearHigh) yearLow = yearHigh
  return { yearLow, yearHigh }
}

function yearsInRange(yearLow: number, yearHigh: number): number[] {
  const out: number[] = []
  for (let y = yearLow; y <= yearHigh; y += 1) out.push(y)
  return out
}

function clampDate(date: Date, min?: string, max?: string): Date {
  const d = new Date(date.getTime())
  const minDate = parseDate(min)
  const maxDate = parseDate(max)
  if (minDate && d < minDate) return minDate
  if (maxDate && d > maxDate) return maxDate
  return d
}

function formatISO(d: Date | null): string {
  if (!d) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDisplay(d: Date | null): string {
  if (!d) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const y = d.getFullYear()
  return `${m}/${y}`
}

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'mm/aaaa',
  className = '',
}: DatePickerProps) {
  const selectedDate = parseDate(value)
  const initialView = selectedDate ?? new Date()
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(initialView.getFullYear())
  const [viewMonth, setViewMonth] = useState(initialView.getMonth()) // 0-based
  const [inputText, setInputText] = useState<string>(formatDisplay(selectedDate))
  const rootRef = useRef<HTMLDivElement | null>(null)

  const displayValue = formatDisplay(selectedDate)

  const yearOptions = useMemo(() => {
    const { yearLow, yearHigh } = yearBounds(min, max)
    return yearsInRange(yearLow, yearHigh)
  }, [min, max])

  useEffect(() => {
    if (yearOptions.length === 0) return
    if (!yearOptions.includes(viewYear)) {
      const hi = yearOptions[yearOptions.length - 1]
      const lo = yearOptions[0]
      setViewYear(viewYear > hi ? hi : lo)
    }
  }, [yearOptions, viewYear])

  // Mantener sincronizado el texto cuando cambia el valor externo
  useEffect(() => {
    setInputText(displayValue)
  }, [displayValue])

  // Cerrar el popup al hacer clic fuera del componente
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current) return
      if (event.target instanceof Node && rootRef.current.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [open])

  const goMonth = (delta: number) => {
    let y = viewYear
    let m = viewMonth + delta
    while (m < 0) {
      m += 12
      y -= 1
    }
    while (m > 11) {
      m -= 12
      y += 1
    }
    setViewYear(y)
    setViewMonth(m)
    const candidate = new Date(y, m, 1)
    const clamped = clampDate(candidate, min, max)
    onChange(formatISO(clamped))
  }

  return (
    <div ref={rootRef} className={`relative inline-block w-full ${className}`}>
      <input
        type="text"
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        onBlur={() => {
          const raw = inputText.trim()
          if (!raw) return
          const m = /^(\d{1,2})\/(\d{4})$/.exec(raw)
          if (!m) return
          const month = Number(m[1])
          const year = Number(m[2])
          if (!Number.isFinite(month) || !Number.isFinite(year)) return
          if (month < 1 || month > 12) return
          const candidate = new Date(year, month - 1, 1)
          const clamped = clampDate(candidate, min, max)
          onChange(formatISO(clamped))
        }}
        placeholder={placeholder}
        className="h-10 w-full rounded-md border border-outline-variant bg-input-bg px-3 pr-8 text-sm text-on-surface shadow-[var(--app-shadow)] placeholder:text-on-surface-variant/55 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 tabular-nums"
      />
      <button
        type="button"
        onClick={() => {
          // Si aún no hay valor seleccionado, al abrir por primera vez usamos el mes/año actual
          // (respetando min/max) para evitar tener que cambiar y volver a seleccionar.
          if (!open && !selectedDate) {
            const candidate = clampDate(initialView, min, max)
            onChange(formatISO(candidate))
          }
          setOpen((v) => !v)
        }}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-on-surface-variant hover:text-on-surface"
        aria-label="Abrir selector de fecha"
      >
        <span aria-hidden="true">📅</span>
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 w-64 rounded-md border border-outline-variant bg-surface p-2 text-xs shadow-[var(--app-shadow)]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="rounded px-1 py-0.5 text-on-surface-variant hover:bg-ghost-hover"
              onClick={() => goMonth(-1)}
            >
              ‹
            </button>
            <div className="flex items-center gap-2">
              <select
                value={viewMonth}
                onChange={(e) => {
                  const nextMonth = Number(e.target.value)
                  setViewMonth(nextMonth)
                  const candidate = new Date(viewYear, nextMonth, 1)
                  const clamped = clampDate(candidate, min, max)
                  onChange(formatISO(clamped))
                }}
                className="rounded border border-outline-variant bg-input-bg px-1 py-0.5 text-[11px] text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                {MONTHS.map((name, idx) => (
                  <option key={name} value={idx}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={viewYear}
                onChange={(e) => {
                  const nextYear = Number(e.target.value)
                  setViewYear(nextYear)
                  const candidate = new Date(nextYear, viewMonth, 1)
                  const clamped = clampDate(candidate, min, max)
                  onChange(formatISO(clamped))
                }}
                className="rounded border border-outline-variant bg-input-bg px-1 py-0.5 text-[11px] text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="rounded px-1 py-0.5 text-on-surface-variant hover:bg-ghost-hover"
              onClick={() => goMonth(1)}
            >
              ›
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

