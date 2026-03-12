import { useEffect, useState } from 'react'

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

  const displayValue = formatDisplay(selectedDate)

  // Mantener sincronizado el texto cuando cambia el valor externo
  useEffect(() => {
    setInputText(displayValue)
  }, [displayValue])

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
  }

  const handleSelect = (d: Date) => {
    const clamped = clampDate(d, min, max)
    onChange(formatISO(clamped))
    setOpen(false)
  }

  return (
    <div className={`relative inline-block w-full ${className}`}>
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
        className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 pr-8 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 tabular-nums"
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-gray-400 hover:text-gray-600"
        aria-label="Abrir selector de fecha"
      >
        <span aria-hidden="true">📅</span>
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 w-64 rounded-md border border-gray-200 bg-white p-2 text-xs shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="rounded px-1 py-0.5 text-gray-600 hover:bg-gray-100"
              onClick={() => goMonth(-1)}
            >
              ‹
            </button>
            <div className="flex items-center gap-2">
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(Number(e.target.value))}
                className="rounded border border-gray-300 bg-white px-1 py-0.5 text-[11px] text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
              >
                {MONTHS.map((name, idx) => (
                  <option key={name} value={idx}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={viewYear}
                onChange={(e) => setViewYear(Number(e.target.value))}
                className="rounded border border-gray-300 bg-white px-1 py-0.5 text-[11px] text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
              >
                {Array.from({ length: 15 }).map((_, idx) => {
                  const year = new Date().getFullYear() - 10 + idx
                  return (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  )
                })}
              </select>
            </div>
            <button
              type="button"
              className="rounded px-1 py-0.5 text-gray-600 hover:bg-gray-100"
              onClick={() => goMonth(1)}
            >
              ›
            </button>
          </div>
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
              onClick={() => handleSelect(new Date(viewYear, viewMonth, 1))}
            >
              Usar mes seleccionado
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

