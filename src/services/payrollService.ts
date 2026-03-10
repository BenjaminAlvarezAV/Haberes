import { apiClient } from './apiClient'
import type { NormalizedPayroll } from '../types/payroll'
import { normalizeResponse } from '../utils/normalizeResponse'

export interface FetchPayrollParams {
  cuils: string[]
  periodos: string[]
}

export async function fetchPayroll(
  cuils: string[],
  periodos: string[],
): Promise<NormalizedPayroll> {
  const path = (import.meta.env.VITE_PAYROLL_PATH as string | undefined) ?? '/payroll'
  const resp = await apiClient.post<unknown, { data: unknown }, FetchPayrollParams>(path, {
    cuils,
    periodos,
  })
  return normalizeResponse(resp.data)
}
