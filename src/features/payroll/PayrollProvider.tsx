import { useCallback, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import { fetchChequesForPairs } from '../../services/chequesService'
import { toAppError } from '../../services/apiClient'
import { PayrollContext, validationError, type PayrollContextValue } from './PayrollContext'
import { payrollReducer, initialPayrollState } from './payrollReducer'
import { currentPeriod, expandPeriodRange, isFuturePeriod } from '../../utils/period'
import { normalizeCuil } from '../../utils/cuil'
import type { NormalizedPayroll, PayrollItem } from '../../types/payroll'
import type { AppError } from '../../types/errors'

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
      dispatch({ type: 'FETCH_ERROR', payload: effective.error as AppError })
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
      // 1) A partir de los CUILs y períodos efectivos armamos todos los pares (doc + período YYYYMM)
      const pairKeys = new Set<string>()
      const pairs = effective.cuils
        .flatMap((id) =>
          effective.periodos.map((p) => {
            const periodoYYYYMM = p.replace('-', '')
            const key = `${id}-${periodoYYYYMM}`
            if (pairKeys.has(key)) return null
            pairKeys.add(key)
            return { id, periodoYYYYMM }
          }),
        )
        .filter((p): p is { id: string; periodoYYYYMM: string } => p !== null)

      dispatch({
        type: 'SET_FETCH_PROGRESS',
        payload: { label: 'Consultando cheques…', current: 0, total: pairs.length || 1 },
      })

      // 2) Consultamos los 3 endpoints de cheques para cada par.
      const chequesMap =
        pairs.length > 0
          ? await fetchChequesForPairs(pairs, {
              concurrency: 6,
              onProgress: (current: number, total: number) => {
                dispatch({
                  type: 'SET_FETCH_PROGRESS',
                  payload: { label: 'Consultando cheques…', current, total },
                })
              },
            })
          : {}

      // 3) Construimos la "nómina" a partir de cheques,
      //    respetando los importes y descripciones que vienen de los endpoints.
      const items: PayrollItem[] = []
      const errors: { cuil: string; message: string }[] = []

      Object.values(chequesMap).forEach((bundle) => {
        const periodo = `${bundle.periodoYYYYMM.slice(0, 4)}-${bundle.periodoYYYYMM.slice(4, 6)}`

        // a) Detalle por secuencia: un item por código (usa "pesos" y "descripcionCodigo").
        bundle.liquidacionPorSecuencia.forEach((row) => {
          if (row.pesos === null || Number.isNaN(row.pesos)) {
            errors.push({
              cuil: bundle.id,
              message: `Importe inválido para código ${row.codigo ?? ''} en período ${periodo}`,
            })
            return
          }

          items.push({
            cuil: bundle.id,
            periodo,
            concepto: row.descripcionCodigo ?? 'Sin concepto',
            importe: row.pesos,
          })
        })

        // b) Línea de resumen por establecimiento (suma de "liquido" por establecimiento).
        const totalLiquido = bundle.liquidPorEstablecimiento.reduce(
          (acc, row) => acc + (row.liquido ?? 0),
          0,
        )
        if (!Number.isNaN(totalLiquido)) {
          items.push({
            cuil: bundle.id,
            periodo,
            concepto: 'Total líquido por establecimiento',
            importe: totalLiquido,
          })
        }

      if (bundle.errors && bundle.errors.length > 0) {
        bundle.errors.forEach((msg) => {
          errors.push({ cuil: bundle.id, message: msg })
        })
      }
      })

      const uniqueCuils = Array.from(new Set(items.map((i) => i.cuil))).sort()
      const normalizedFromCheques: NormalizedPayroll = {
        items,
        agents: uniqueCuils.map((cuil) => ({ cuil })),
        ...(errors.length > 0 ? { errors } : {}),
      }

      dispatch({ type: 'FETCH_SUCCESS', payload: normalizedFromCheques })
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

