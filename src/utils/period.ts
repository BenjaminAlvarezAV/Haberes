export function isValidPeriod(period: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) return false
  const month = Number(period.slice(5, 7))
  return month >= 1 && month <= 12
}

export function currentPeriod(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function currentYYYYMM(): string {
  return currentPeriod().replace('-', '')
}

export function isFuturePeriod(period: string, nowPeriod: string = currentPeriod()): boolean {
  // formato fijo YYYY-MM => comparación lexicográfica funciona.
  return period > nowPeriod
}

export function isValidYYYYMM(value: string): boolean {
  if (!/^\d{6}$/.test(value)) return false
  const month = Number(value.slice(4, 6))
  return month >= 1 && month <= 12
}

export function isFutureYYYYMM(value: string, nowYYYYMM: string = currentYYYYMM()): boolean {
  return value > nowYYYYMM
}

export function yyyymmToPeriod(value: string): string {
  // YYYYMM -> YYYY-MM
  return `${value.slice(0, 4)}-${value.slice(4, 6)}`
}

export function expandYYYYMMRange(fromYYYYMM: string, toYYYYMM: string): string[] {
  if (!isValidYYYYMM(fromYYYYMM) || !isValidYYYYMM(toYYYYMM)) return []
  if (fromYYYYMM > toYYYYMM) return []

  const periods: string[] = []
  let y = Number(fromYYYYMM.slice(0, 4))
  let m = Number(fromYYYYMM.slice(4, 6))
  const endY = Number(toYYYYMM.slice(0, 4))
  const endM = Number(toYYYYMM.slice(4, 6))

  while (y < endY || (y === endY && m <= endM)) {
    periods.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m === 13) {
      m = 1
      y += 1
    }
  }

  return periods
}
