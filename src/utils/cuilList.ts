import { normalizeCuil } from './cuil'

export interface ParseCuilListReport {
  totalTokens: number
  valid: number
  invalid: number
  duplicates: number
}

export interface ParseCuilListResult {
  cuils: string[]
  invalidTokens: string[]
  duplicateCuils: string[]
  report: ParseCuilListReport
}

function tokenize(input: string): string[] {
  // Separa por espacios, saltos, coma, punto y coma.
  return input
    .split(/[\s,;]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
}

export function parseCuilListTextDetailed(text: string, minLength: number = 11): ParseCuilListResult {
  // Back-compat: mantener firma vieja (minLength) pero preferir allowedLengths vía options en overload.
  const tokens = tokenize(text)
  const seen = new Set<string>()

  const cuils: string[] = []
  const invalidTokens: string[] = []
  const duplicateCuils: string[] = []

  for (const tok of tokens) {
    const cuil = normalizeCuil(tok)
    const okLength = cuil.length >= minLength
    if (!/^\d+$/.test(cuil) || !okLength) {
      invalidTokens.push(tok)
      continue
    }
    if (seen.has(cuil)) {
      duplicateCuils.push(cuil)
      continue
    }
    seen.add(cuil)
    cuils.push(cuil)
  }

  return {
    cuils,
    invalidTokens,
    duplicateCuils,
    report: {
      totalTokens: tokens.length,
      valid: cuils.length,
      invalid: invalidTokens.length,
      duplicates: duplicateCuils.length,
    },
  }
}

export function parseCuilListTextDetailedWithLengths(
  text: string,
  allowedLengths: number[],
): ParseCuilListResult {
  const tokens = tokenize(text)
  const seen = new Set<string>()

  const cuils: string[] = []
  const invalidTokens: string[] = []
  const duplicateCuils: string[] = []

  for (const tok of tokens) {
    const cuil = normalizeCuil(tok)
    const okLength = allowedLengths.includes(cuil.length)
    if (!/^\d+$/.test(cuil) || !okLength) {
      invalidTokens.push(tok)
      continue
    }
    if (seen.has(cuil)) {
      duplicateCuils.push(cuil)
      continue
    }
    seen.add(cuil)
    cuils.push(cuil)
  }

  return {
    cuils,
    invalidTokens,
    duplicateCuils,
    report: {
      totalTokens: tokens.length,
      valid: cuils.length,
      invalid: invalidTokens.length,
      duplicates: duplicateCuils.length,
    },
  }
}

