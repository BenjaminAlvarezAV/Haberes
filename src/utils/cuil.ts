export function normalizeCuil(raw: string): string {
  return raw.replace(/[^\d]/g, '')
}

export function isLikelyCuil(cuil: string, minLength = 11): boolean {
  if (cuil.length < minLength) return false
  return /^\d+$/.test(cuil)
}
