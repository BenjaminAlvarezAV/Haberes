import type { NormalizedPayroll, PayrollItem } from '../types/payroll'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stableNumber(seed: string): number {
  // hash simple y estable (no cripto) para mocks repetibles
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h)
}

export async function mockFetchPayroll(
  cuils: string[],
  periodos: string[],
): Promise<NormalizedPayroll> {
  await sleep(1000)

  const items: PayrollItem[] = []
  for (const cuil of cuils) {
    for (const periodo of periodos) {
      const base = 50_000 + (stableNumber(`${cuil}-${periodo}-base`) % 12_000)
      const antig = 2_000 + (stableNumber(`${cuil}-${periodo}-ant`) % 4_000)
      const desc = 500 + (stableNumber(`${cuil}-${periodo}-desc`) % 2_000)

      items.push({ cuil, periodo, concepto: 'Sueldo Básico', importe: base, tipo: 'HABER' })
      items.push({ cuil, periodo, concepto: 'Antigüedad', importe: antig, tipo: 'HABER' })
      items.push({ cuil, periodo, concepto: 'Descuentos', importe: -desc, tipo: 'DESCUENTO' })
    }
  }

  const agents = cuils.map((cuil) => ({
    cuil,
    nombre: `Docente ${cuil.slice(-4)}`,
  }))

  return { items, agents }
}
