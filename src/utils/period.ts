export function isValidPeriod(period: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) return false
  const month = Number(period.slice(5, 7))
  return month >= 1 && month <= 12
}
