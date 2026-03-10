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
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined

  if (!baseUrl) {
    throw new Error('VITE_API_BASE_URL no está configurada; no se puede consultar Haberes.')
  }

  const resp = await apiClient.post<unknown, { data: unknown }, FetchPayrollParams>(path, {
    cuils,
    periodos,
  })
  return normalizeResponse(resp.data)
}
