import type { AppError } from '../../types/errors'
import type { GroupMode, NormalizedPayroll } from '../../types/payroll'
import type { ParseCuilReport } from '../../utils/txtParser'

export interface PayrollState {
  cuils: string[]
  periodos: string[]
  groupMode: GroupMode
  loading: boolean
  error: AppError | null
  data: NormalizedPayroll | null
  lastUploadReport: ParseCuilReport | null
}

export type PayrollAction =
  | { type: 'SET_CUILS'; payload: { cuils: string[]; report: ParseCuilReport | null } }
  | { type: 'SET_PERIODOS'; payload: string[] }
  | { type: 'SET_GROUP_MODE'; payload: GroupMode }
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: NormalizedPayroll }
  | { type: 'FETCH_ERROR'; payload: AppError }
  | { type: 'CLEAR_ERROR' }

export const initialPayrollState: PayrollState = {
  cuils: [],
  periodos: [],
  groupMode: 'agent',
  loading: false,
  error: null,
  data: null,
  lastUploadReport: null,
}

function assertNever(x: never): never {
  throw new Error(`Acción no manejada: ${JSON.stringify(x)}`)
}

export function payrollReducer(state: PayrollState, action: PayrollAction): PayrollState {
  switch (action.type) {
    case 'SET_CUILS':
      return {
        ...state,
        cuils: action.payload.cuils,
        lastUploadReport: action.payload.report,
        data: null,
        error: null,
      }
    case 'SET_PERIODOS':
      return { ...state, periodos: action.payload, data: null }
    case 'SET_GROUP_MODE':
      return { ...state, groupMode: action.payload }
    case 'FETCH_START':
      return { ...state, loading: true, error: null }
    case 'FETCH_SUCCESS':
      return { ...state, loading: false, data: action.payload }
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.payload }
    case 'CLEAR_ERROR':
      return { ...state, error: null }
    default: {
      return assertNever(action)
    }
  }
}
