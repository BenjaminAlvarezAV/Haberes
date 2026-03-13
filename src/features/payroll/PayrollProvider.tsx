import { useCallback, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import { fetchChequesForPairs } from '../../services/chequesService'
import { toAppError } from '../../services/apiClient'
import { PayrollContext, validationError, type PayrollContextValue } from './PayrollContext'
import { payrollReducer, initialPayrollState } from './payrollReducer'
import { currentPeriod, isFuturePeriod } from '../../utils/period'
import { normalizeCuil } from '../../utils/cuil'
import type { NormalizedPayroll, PayrollItem } from '../../types/payroll'
import type { AppError } from '../../types/errors'

export function PayrollProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(payrollReducer, initialPayrollState)

  const consult = useCallback(async () => {
    // CSV obligatorio solo para modo "lote".
    if (state.queryMode === 'batch' && state.cuils.length === 0) {
      dispatch({
        type: 'FETCH_ERROR',
        payload: validationError('Cargá un CSV con al menos una fila válida para usar el modo Lote (CSV)'),
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

            // En modo manual reutilizamos la misma lista de períodos seleccionados (state.periodos)
            // que en el modo por lote.
            return { cuils: [id], periodos: state.periodos }
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
      const rawErrors: { cuil: string; message: string; periodo: string }[] = []

      // Para detectar si un documento falló en TODOS los períodos consultados.
      const totalPeriodsByCuil = new Map<string, Set<string>>()
      const errorPeriodsByCuil = new Map<string, Set<string>>()

      const registerError = (cuil: string, periodo: string, message: string) => {
        rawErrors.push({ cuil, message, periodo })
        const set = errorPeriodsByCuil.get(cuil) ?? new Set<string>()
        set.add(periodo)
        errorPeriodsByCuil.set(cuil, set)
      }

      Object.values(chequesMap).forEach((bundle) => {
        const periodo = `${bundle.periodoYYYYMM.slice(0, 4)}-${bundle.periodoYYYYMM.slice(4, 6)}`

        // Registrar período consultado para este documento.
        const totalSet = totalPeriodsByCuil.get(bundle.id) ?? new Set<string>()
        totalSet.add(periodo)
        totalPeriodsByCuil.set(bundle.id, totalSet)

        // a) Detalle por secuencia: un item por código (usa "pesos" y "descripcionCodigo").
        let hasNonZeroDetail = false
        bundle.liquidacionPorSecuencia.forEach((row) => {
          if (row.pesos === null || Number.isNaN(row.pesos)) {
            registerError(
              bundle.id,
              periodo,
              `Importe inválido para código ${row.codigo ?? ''} en período ${periodo}`,
            )
            return
          }

          if (row.pesos !== 0) hasNonZeroDetail = true

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
        // Solo agregamos la fila de resumen si hay algún dato distinto de 0
        // o si el total líquido no es 0. Esto evita generar PDFs vacíos con
        // todos los importes en 0.
        if (!Number.isNaN(totalLiquido) && (hasNonZeroDetail || totalLiquido !== 0)) {
          items.push({
            cuil: bundle.id,
            periodo,
            concepto: 'Total líquido por establecimiento',
            importe: totalLiquido,
          })
        }

        // c) Si el servicio devolvió todo en 0 (sin detalle ni líquido), registramos un mensaje claro.
        if (!hasNonZeroDetail && totalLiquido === 0) {
          registerError(
            bundle.id,
            periodo,
            `No se detectaron pagos para este período. Es posible que todavía no estén acreditados o que haya un problema en el servicio de consulta.`,
          )
        }

        if (bundle.errors && bundle.errors.length > 0) {
          bundle.errors.forEach((msg) => {
            registerError(bundle.id, periodo, msg)
          })
        }
      })

      // Identificamos documentos para los que TODOS los períodos consultados tuvieron algún error,
      // y colapsamos sus errores en un único mensaje resumen.
      const finalErrors: { cuil: string; message: string }[] = []
      const groupedByCuil = new Map<string, { cuil: string; message: string; periodo: string }[]>()
      rawErrors.forEach((e) => {
        const arr = groupedByCuil.get(e.cuil) ?? []
        arr.push(e)
        groupedByCuil.set(e.cuil, arr)
      })

      groupedByCuil.forEach((errs, cuil) => {
        const totalPeriods = totalPeriodsByCuil.get(cuil)
        const errorPeriods = errorPeriodsByCuil.get(cuil)
        const totalCount = totalPeriods?.size ?? 0
        const errorCount = errorPeriods?.size ?? 0

        if (totalCount > 0 && errorCount === totalCount) {
          finalErrors.push({
            cuil,
            message:
              'No se pudieron obtener pagos en ninguno de los períodos consultados para este documento. Verificá que los datos sean correctos o intentá más tarde.',
          })
        } else {
          errs.forEach((e) => {
            finalErrors.push({ cuil: e.cuil, message: e.message })
          })
        }
      })

      const uniqueCuils = Array.from(new Set(items.map((i) => i.cuil))).sort()
      const normalizedFromCheques: NormalizedPayroll = {
        items,
        agents: uniqueCuils.map((cuil) => ({ cuil })),
        ...(finalErrors.length > 0 ? { errors: finalErrors } : {}),
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

