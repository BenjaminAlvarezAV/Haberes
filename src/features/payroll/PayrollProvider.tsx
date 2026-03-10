import { useCallback, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import { fetchPayroll } from '../../services/payrollService'
import { fetchChequesForPairs } from '../../services/chequesService'
import { toAppError } from '../../services/apiClient'
import { PayrollContext, validationError, type PayrollContextValue } from './PayrollContext'
import { payrollReducer, initialPayrollState } from './payrollReducer'
import { currentPeriod, expandPeriodRange, isFuturePeriod } from '../../utils/period'
import { normalizeCuil } from '../../utils/cuil'

export function PayrollProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(payrollReducer, initialPayrollState)

  const consult = useCallback(async () => {
    // CSV obligatorio (en ambos modos).
    if (state.cuils.length === 0) {
      dispatch({
        type: 'FETCH_ERROR',
        payload: validationError('Cargá un CSV con al menos una fila válida'),
      })
      return
    }

    const max = currentPeriod()

    const effective =
      state.queryMode === 'batch'
        ? (() => {
            const cuils = Array.from(new Set(state.cuils.map((c) => normalizeCuil(c))))
              .map((id) => id.trim())
              .filter((id) => /^\d+$/.test(id) && (id.length === 8 || id.length === 11))

            if (cuils.length === 0) {
              return { error: validationError('El CSV no contiene CUIL/DNI válidos (11 o 8 dígitos, sin guiones)') }
            }

            return { cuils, periodos: state.periodos }
          })()
        : (() => {
            const id = normalizeCuil(state.manualCuil)
            const isOk = /^\d+$/.test(id) && (id.length === 8 || id.length === 11)
            if (!isOk) {
              return { error: validationError('Ingresá un CUIL/DNI válido (11 o 8 dígitos, sin guiones)') }
            }

            const setAvailable = new Set(state.availablePeriodos)
            if (state.availablePeriodos.length === 0) {
              return { error: validationError('No hay períodos disponibles derivados del CSV') }
            }

            // Período (mes) es obligatorio siempre.
            if (!state.manualMonth) {
              return { error: validationError('Seleccioná un período (mes)') }
            }
            if (!setAvailable.has(state.manualMonth)) {
              return { error: validationError('El período seleccionado no está disponible según el CSV') }
            }

            // Rango opcional: si está completo, usamos rango; si no, usamos el mes.
            if (state.manualFrom && state.manualTo) {
              const desired = expandPeriodRange(state.manualFrom, state.manualTo)
              const periodos = desired.filter((p) => setAvailable.has(p))
              if (periodos.length === 0) {
                return { error: validationError('El rango no tiene períodos disponibles según el CSV') }
              }
              return { cuils: [id], periodos }
            }

            return { cuils: [id], periodos: [state.manualMonth] }
          })()

    if ('error' in effective) {
      dispatch({ type: 'FETCH_ERROR', payload: effective.error })
      return
    }

    if (effective.periodos.length === 0) {
      dispatch({
        type: 'FETCH_ERROR',
        payload: validationError('Seleccioná al menos un período (YYYY-MM)'),
      })
      return
    }

    const hasFuture = effective.periodos.some((p) => isFuturePeriod(p, max))
    if (hasFuture) {
      dispatch({
        type: 'FETCH_ERROR',
        payload: validationError(`No se permiten períodos futuros (máximo ${max})`),
      })
      return
    }

    dispatch({ type: 'FETCH_START' })
    try {
      dispatch({ type: 'SET_FETCH_PROGRESS', payload: { label: 'Consultando haberes…', current: 0, total: 1 } })
      // 1) Consultamos haberes (base) para la UI.
      const normalized = await fetchPayroll(effective.cuils, effective.periodos)
      dispatch({ type: 'SET_FETCH_PROGRESS', payload: { label: 'Consultando haberes…', current: 1, total: 1 } })

      // 2) Consultamos todos los endpoints de cheques para completar el PDF.
      // Se hace en cada consulta (requerimiento).
      const pairKeys = new Set<string>()
      const pairs = normalized.items
        .map((it) => ({ id: it.cuil, periodoYYYYMM: it.periodo.replace('-', '') }))
        .filter((pair) => {
          const key = `${pair.id}-${pair.periodoYYYYMM}`
          if (pairKeys.has(key)) return false
          pairKeys.add(key)
          return true
        })
        .filter((pair) => {
          const existing = state.chequesByKey[`${pair.id}-${pair.periodoYYYYMM}`]
          return !existing || (existing.errors && existing.errors.length > 0)
        })
      dispatch({
        type: 'SET_FETCH_PROGRESS',
        payload: { label: 'Consultando cheques…', current: 0, total: pairs.length },
      })
      const chequesMap =
        pairs.length > 0
          ? await fetchChequesForPairs(pairs, {
              concurrency: 6,
              onProgress: (current, total) => {
                dispatch({
                  type: 'SET_FETCH_PROGRESS',
                  payload: { label: 'Consultando cheques…', current, total },
                })
              },
            })
          : {}

      dispatch({ type: 'FETCH_SUCCESS', payload: normalized })
      if (Object.keys(chequesMap).length > 0) {
        dispatch({ type: 'SET_CHEQUES_MAP', payload: chequesMap })
      }
    } catch (e: unknown) {
      dispatch({ type: 'FETCH_ERROR', payload: toAppError(e) })
    }
  }, [
    state.cuils,
    state.periodos,
    state.queryMode,
    state.manualCuil,
    state.manualMonth,
    state.manualFrom,
    state.manualTo,
    state.availablePeriodos,
    state.chequesByKey,
  ])

  const value = useMemo<PayrollContextValue>(
    () => ({ ...state, dispatch, consult }),
    [state, consult],
  )

  return <PayrollContext.Provider value={value}>{children}</PayrollContext.Provider>
}

