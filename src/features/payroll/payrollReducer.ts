import type { AppError } from '../../types/errors'
import type { GroupMode, NormalizedPayroll } from '../../types/payroll'
import type { ChequesBundle } from '../../types/cheques'
import type { ParseCuilReport } from '../../utils/txtParser'

export type QueryMode = 'batch' | 'manual'

export interface CsvSource {
  name: string
  documentos: string[]
  periodos: string[]
  report: ParseCuilReport | null
}

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
  csvSources: CsvSource[]
  dataStale: boolean
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
  | { type: 'ADD_CSV_SOURCE'; payload: CsvSource }
  | { type: 'REMOVE_CSV_SOURCE'; payload: { index: number } }

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
  csvSources: [],
  dataStale: false,
}

function recomputeFromSources(sources: CsvSource[]): {
  cuils: string[]
  availablePeriodos: string[]
  periodos: string[]
} {
  const docs = new Set<string>()
  const periods = new Set<string>()
  sources.forEach((s) => {
    s.documentos.forEach((d) => docs.add(d))
    s.periodos.forEach((p) => periods.add(p))
  })
  const cuils = Array.from(docs).sort()
  const availablePeriodos = Array.from(periods).sort()
  // Por defecto, todos los períodos disponibles quedan seleccionados.
  const periodos = [...availablePeriodos]
  return { cuils, availablePeriodos, periodos }
}

function assertNever(x: never): never {
  throw new Error(`Acción no manejada: ${JSON.stringify(x)}`)
}

export function payrollReducer(state: PayrollState, action: PayrollAction): PayrollState {
  switch (action.type) {
    case 'SET_CUILS':
      // Nuevo comportamiento: acumular documentos de varios CSVs en lugar de reemplazarlos.
      // Usamos un Set para evitar duplicados.
      const mergedCuils = Array.from(new Set([...state.cuils, ...action.payload.cuils]))
      return {
        ...state,
        cuils: mergedCuils,
        lastUploadReport: action.payload.report,
        error: null,
      }
    case 'SET_AVAILABLE_PERIODOS':
      // Nuevo comportamiento: fusionar períodos derivados de múltiples CSVs.
      // availablePeriodos: fuente total; periodos: seleccionados (por defecto, todos).
      const mergedAvailable = Array.from(
        new Set([...state.availablePeriodos, ...action.payload]),
      ).sort()
      const mergedSelected = Array.from(new Set([...state.periodos, ...action.payload])).sort()
      return {
        ...state,
        availablePeriodos: mergedAvailable,
        periodos: mergedSelected,
        error: null,
      }
    case 'ADD_CSV_SOURCE': {
      const csvSources = [...state.csvSources, action.payload]
      const { cuils, availablePeriodos, periodos } = recomputeFromSources(csvSources)
      return {
        ...state,
        csvSources,
        cuils,
        availablePeriodos,
        periodos,
        lastUploadReport: action.payload.report,
        dataStale: state.data !== null,
        error: null,
      }
    }
    case 'REMOVE_CSV_SOURCE': {
      const csvSources = state.csvSources.filter((_, idx) => idx !== action.payload.index)
      const { cuils, availablePeriodos, periodos } = recomputeFromSources(csvSources)
      return {
        ...state,
        csvSources,
        cuils,
        availablePeriodos,
        periodos,
        dataStale: state.data !== null,
        error: null,
      }
    }
    case 'SET_PERIODOS':
      return { ...state, periodos: action.payload, data: null, dataStale: false }
    case 'SET_QUERY_MODE':
      return { ...state, queryMode: action.payload, data: null, dataStale: false, error: null }
    case 'SET_MANUAL_CUIL':
      return { ...state, manualCuil: action.payload, data: null, dataStale: false, error: null }
    case 'SET_MANUAL_MONTH':
      return { ...state, manualMonth: action.payload, data: null, dataStale: false, error: null }
    case 'SET_MANUAL_RANGE':
      return {
        ...state,
        manualFrom: action.payload.from,
        manualTo: action.payload.to,
        data: null,
        dataStale: false,
        error: null,
      }
    case 'SET_GROUP_MODE':
      return { ...state, groupMode: action.payload }
    case 'FETCH_START':
      return { ...state, loading: true, error: null, fetchProgress: null, chequesByKey: {}, dataStale: false }
    case 'SET_FETCH_PROGRESS':
      return { ...state, fetchProgress: action.payload }
    case 'FETCH_SUCCESS':
      return { ...state, loading: false, data: action.payload, fetchProgress: null, dataStale: false }
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
