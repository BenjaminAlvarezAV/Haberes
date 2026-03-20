import { createContext } from 'react'
import type { AppError } from '../../types/errors'
import type { ParseCuilReport } from '../../utils/txtParser'
import type { GroupMode, NormalizedPayroll } from '../../types/payroll'
import type { ChequesBundle } from '../../types/cheques'
import type { CsvSource, PayrollAction, QueryMode } from './payrollReducer'

export interface PayrollStateShape {
  cuils: string[]
  availablePeriodos: string[]
  periodos: string[]
  batchUseManualPeriods: boolean
  queryMode: QueryMode
  manualCuil: string
  manualMonth: string
  manualFrom: string
  manualTo: string
  groupMode: GroupMode
  loading: boolean
  error: AppError | null
  data: NormalizedPayroll | null
  chequesByKey: Record<string, ChequesBundle>
  lastUploadReport: ParseCuilReport | null
  fetchProgress: { label: string; current: number; total: number } | null
  csvSources: CsvSource[]
  dataStale: boolean
}

export interface PayrollContextValue extends PayrollStateShape {
  dispatch: (action: PayrollAction) => void
  consult: () => Promise<void>
}

export const PayrollContext = createContext<PayrollContextValue | null>(null)

export function validationError(message: string): AppError {
  return { kind: 'validation', message }
}
