import type { AppError } from '../../types/errors'
import type { GroupMode, NormalizedPayroll } from '../../types/payroll'
import type { ChequesBundle } from '../../types/cheques'
import type { ParseCuilReport } from '../../utils/txtParser'

export type QueryMode = 'batch' | 'manual'

export interface PayrollState {
  cuils: string[]
  /** Períodos derivados del CSV (fuente). */
  availablePeriodos: string[]
  /** Períodos seleccionados para consultar (filtro). */
  periodos: string[]
  /** Modo de consulta luego de cargar el CSV. */
  queryMode: QueryMode
  /** Entrada manual: un único CUIL/DNI (solo dígitos, sin guiones). */
  manualCuil: string
  /** Entrada manual: mes específico (YYYY-MM). */
  manualMonth: string
  /** Entrada manual: rango DESDE (YYYY-MM). */
  manualFrom: string
  /** Entrada manual: rango HASTA (YYYY-MM). */
  manualTo: string
  groupMode: GroupMode
  loading: boolean
  error: AppError | null
  data: NormalizedPayroll | null
  chequesByKey: Record<string, ChequesBundle>
  lastUploadReport: ParseCuilReport | null
  fetchProgress: { label: string; current: number; total: number } | null
}

export type PayrollAction =
  | { type: 'SET_CUILS'; payload: { cuils: string[]; report: ParseCuilReport | null } }
  | { type: 'SET_AVAILABLE_PERIODOS'; payload: string[] }
  | { type: 'SET_PERIODOS'; payload: string[] }
  | { type: 'SET_QUERY_MODE'; payload: QueryMode }
  | { type: 'SET_MANUAL_CUIL'; payload: string }
  | { type: 'SET_MANUAL_MONTH'; payload: string }
  | { type: 'SET_MANUAL_RANGE'; payload: { from: string; to: string } }
  | { type: 'SET_GROUP_MODE'; payload: GroupMode }
  | { type: 'FETCH_START' }
  | { type: 'SET_FETCH_PROGRESS'; payload: { label: string; current: number; total: number } }
  | { type: 'FETCH_SUCCESS'; payload: NormalizedPayroll }
  | { type: 'SET_CHEQUES_MAP'; payload: Record<string, ChequesBundle> }
  | { type: 'FETCH_ERROR'; payload: AppError }
  | { type: 'CLEAR_ERROR' }

export const initialPayrollState: PayrollState = {
  cuils: [],
  availablePeriodos: [],
  periodos: [],
  queryMode: 'batch',
  manualCuil: '',
  manualMonth: '',
  manualFrom: '',
  manualTo: '',
  groupMode: 'agent',
  loading: false,
  error: null,
  data: null,
  chequesByKey: {},
  lastUploadReport: null,
  fetchProgress: null,
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
        availablePeriodos: [],
        periodos: [],
        queryMode: 'batch',
        manualCuil: '',
        manualMonth: '',
        manualFrom: '',
        manualTo: '',
        data: null,
        chequesByKey: {},
        error: null,
      }
    case 'SET_AVAILABLE_PERIODOS':
      // Cuando cambia el archivo/fuente, por defecto seleccionamos todo el rango derivado.
      return {
        ...state,
        availablePeriodos: action.payload,
        periodos: action.payload,
        data: null,
        chequesByKey: {},
        error: null,
      }
    case 'SET_PERIODOS':
      return { ...state, periodos: action.payload, data: null }
    case 'SET_QUERY_MODE':
      return { ...state, queryMode: action.payload, data: null, error: null }
    case 'SET_MANUAL_CUIL':
      return { ...state, manualCuil: action.payload, data: null, error: null }
    case 'SET_MANUAL_MONTH':
      return { ...state, manualMonth: action.payload, data: null, error: null }
    case 'SET_MANUAL_RANGE':
      return { ...state, manualFrom: action.payload.from, manualTo: action.payload.to, data: null, error: null }
    case 'SET_GROUP_MODE':
      return { ...state, groupMode: action.payload }
    case 'FETCH_START':
      return { ...state, loading: true, error: null, fetchProgress: null, chequesByKey: {} }
    case 'SET_FETCH_PROGRESS':
      return { ...state, fetchProgress: action.payload }
    case 'FETCH_SUCCESS':
      return { ...state, loading: false, data: action.payload, fetchProgress: null }
    case 'SET_CHEQUES_MAP':
      return { ...state, chequesByKey: { ...state.chequesByKey, ...action.payload } }
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.payload, fetchProgress: null }
    case 'CLEAR_ERROR':
      return { ...state, error: null }
    default: {
      return assertNever(action)
    }
  }
}
