import { useCallback, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import { fetchPayroll } from '../../services/payrollService'
import { toAppError } from '../../services/apiClient'
import { PayrollContext, validationError, type PayrollContextValue } from './PayrollContext'
import { payrollReducer, initialPayrollState } from './payrollReducer'

export function PayrollProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(payrollReducer, initialPayrollState)

  const consult = useCallback(async () => {
    if (state.cuils.length === 0) {
      dispatch({
        type: 'FETCH_ERROR',
        payload: validationError('Cargá un TXT con al menos un CUIL válido'),
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
