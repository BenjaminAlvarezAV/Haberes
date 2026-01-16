import { isLikelyCuil, normalizeCuil } from './cuil'

export interface ParseCuilOptions {
  minLength?: number
}

export interface ParseCuilReport {
  totalLines: number
  valid: number
  invalid: number
  duplicates: number
}

export interface ParseCuilResult {
  cuils: string[]
  report: ParseCuilReport
  invalidLines: string[]
  duplicateCuils: string[]
}

export function parseCuilTextDetailed(
  text: string,
  options: ParseCuilOptions = {},
): ParseCuilResult {
  const minLength = options.minLength ?? 11

  const lines = text.split(/\r?\n/)
  const seen = new Set<string>()
  const duplicateCuils: string[] = []
  const invalidLines: string[] = []
  const cuils: string[] = []

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    const cuil = normalizeCuil(trimmed)
    if (!isLikelyCuil(cuil, minLength)) {
      invalidLines.push(trimmed)
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
    invalidLines,
    duplicateCuils,
    report: {
      totalLines: lines.length,
      valid: cuils.length,
      invalid: invalidLines.length,
      duplicates: duplicateCuils.length,
    },
  }
}

async function readFileAsText(file: File): Promise<string> {
  // `File.text()` no está disponible en todos los entornos (p.ej. jsdom de tests).
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Error al leer el archivo'))
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsText(file)
  })
}

export async function parseCuilTxt(file: File, options: ParseCuilOptions = {}): Promise<string[]> {
  const text = await readFileAsText(file)
  return parseCuilTextDetailed(text, options).cuils
}

export async function parseCuilTxtDetailed(
  file: File,
  options: ParseCuilOptions = {},
): Promise<ParseCuilResult> {
  const text = await readFileAsText(file)
  return parseCuilTextDetailed(text, options)
}
