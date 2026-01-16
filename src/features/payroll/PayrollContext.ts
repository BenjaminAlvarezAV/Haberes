import { createContext } from 'react'
import type { AppError } from '../../types/errors'
import type { ParseCuilReport } from '../../utils/txtParser'
import type { GroupMode, NormalizedPayroll } from '../../types/payroll'
import type { PayrollAction } from './payrollReducer'

export interface PayrollStateShape {
  cuils: string[]
  periodos: string[]
  groupMode: GroupMode
  loading: boolean
  error: AppError | null
  data: NormalizedPayroll | null
  lastUploadReport: ParseCuilReport | null
}

export interface PayrollContextValue extends PayrollStateShape {
  dispatch: (action: PayrollAction) => void
  consult: () => Promise<void>
}

export const PayrollContext = createContext<PayrollContextValue | null>(null)

export function validationError(message: string): AppError {
  return { kind: 'validation', message }
}
