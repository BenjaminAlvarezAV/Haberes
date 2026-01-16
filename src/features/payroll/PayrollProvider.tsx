import { useCallback, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import { fetchPayroll } from '../../services/payrollService'
import { toAppError } from '../../services/apiClient'
import { PayrollContext, validationError, type PayrollContextValue } from './PayrollContext'
import { payrollReducer, initialPayrollState } from './payrollReducer'
import { currentPeriod, isFuturePeriod } from '../../utils/period'

export function PayrollProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(payrollReducer, initialPayrollState)

  const consult = useCallback(async () => {
    if (state.cuils.length === 0) {
      dispatch({
        type: 'FETCH_ERROR',
        payload: validationError('Cargá un CSV con al menos una fila válida'),
      })
      return
    }
    if (state.periodos.length === 0) {
      dispatch({
        type: 'FETCH_ERROR',
        payload: validationError('Seleccioná al menos un período (YYYY-MM)'),
      })
      return
    }

    const max = currentPeriod()
    const hasFuture = state.periodos.some((p) => isFuturePeriod(p, max))
    if (hasFuture) {
      dispatch({
        type: 'FETCH_ERROR',
        payload: validationError(`No se permiten períodos futuros (máximo ${max})`),
      })
      return
    }

    dispatch({ type: 'FETCH_START' })
    try {
      const normalized = await fetchPayroll(state.cuils, state.periodos)
      dispatch({ type: 'FETCH_SUCCESS', payload: normalized })
    } catch (e: unknown) {
      dispatch({ type: 'FETCH_ERROR', payload: toAppError(e) })
    }
  }, [state.cuils, state.periodos])

  const value = useMemo<PayrollContextValue>(
    () => ({ ...state, dispatch, consult }),
    [state, consult],
  )

  return <PayrollContext.Provider value={value}>{children}</PayrollContext.Provider>
}

