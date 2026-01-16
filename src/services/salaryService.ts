import type { SalaryRecord } from '../types/salary'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchSalaries(cuils: string[], periodos: string[]): Promise<SalaryRecord[]> {
  await sleep(1000)

  const records: SalaryRecord[] = []
  let id = 1

  for (const cuil of cuils) {
    for (const periodo of periodos) {
      records.push({
        id: String(id++),
        cuil,
        periodo,
        monto: 50_000,
        detalle: 'Sueldo Básico',
      })
      records.push({
        id: String(id++),
        cuil,
        periodo,
        monto: 2_000,
        detalle: 'Antigüedad',
      })
    }
  }

  return records
}
