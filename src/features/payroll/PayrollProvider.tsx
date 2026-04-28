import { useCallback, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import {
  extractCuilFromLiquidacion,
  fetchChequesForPairs,
  fetchLiquidacionPorSecuencia,
} from '../../services/chequesService'
import { toAppError } from '../../services/apiClient'
import { PayrollContext, validationError, type PayrollContextValue } from './PayrollContext'
import { payrollReducer, initialPayrollState } from './payrollReducer'
import { currentPeriod, expandYYYYMMRange, isFuturePeriod, yyyymmToPeriod } from '../../utils/period'
import { normalizeCuil } from '../../utils/cuil'
import {
  type SecuenciaFilterSpec,
  filterChequesBundleBySecuencia,
  filterSpecFromCsvSecuencia,
  mergeSecuenciaFilterSpecs,
  resolveCsvSecuenciaFilterSpecForPair,
} from '../../utils/chequesSecuenciaFilter'
import type { ChequesBundle } from '../../types/cheques'
import type { NormalizedPayroll, PayrollItem } from '../../types/payroll'
import type { AppError } from '../../types/errors'
import { mapLimit } from '../../utils/promise'

export function PayrollProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(payrollReducer, initialPayrollState)
  // Modo base del proyecto: consulta diferida (on-demand) para todos los volúmenes.
  const ON_DEMAND_PAIR_THRESHOLD = 0

  const consult = useCallback(async () => {
    const hasText = (value: string | null | undefined): boolean =>
      typeof value === 'string' && value.trim().length > 0
    const hasValue = (value: string | number | null | undefined): boolean => {
      if (typeof value === 'number') return Number.isFinite(value)
      return hasText(typeof value === 'string' ? value : null)
    }
    const hasAnyMeaningfulSecuenciaRow = (bundle: ChequesBundle): boolean => {
      return bundle.liquidacionPorSecuencia.some(
        (row) =>
          row.pesos !== null ||
          hasText(row.codigo) ||
          hasText(row.descripcionCodigo) ||
          hasText(row.apYNom) ||
          hasText(row.numDoc) ||
          hasText(row.sexo) ||
          hasText(row.cuitCuil) ||
          hasText(row.mesaPago) ||
          hasText(row.tipoOrg) ||
          hasText(row.numero) ||
          hasText(row.nombreEstab) ||
          hasText(row.tipoOrgInt) ||
          hasText(row.numeroInt) ||
          hasText(row.nombreEstabInt) ||
          hasText(row.secu) ||
          hasText(row.rev) ||
          hasText(row.estabPag) ||
          hasText(row.distritoInt) ||
          hasText(row.ccticas) ||
          hasText(row.ccticasInt) ||
          hasText(row.nomDistInt) ||
          hasText(row.cat) ||
          hasText(row.catInt) ||
          hasText(row.rural) ||
          hasText(row.ruralInt) ||
          hasText(row.secciones) ||
          hasText(row.seccionesInt) ||
          hasText(row.turnos) ||
          hasText(row.turnosInt) ||
          hasText(row.dobEscolEstab) ||
          hasText(row.esCarcel) ||
          hasText(row.esDeno) ||
          hasText(row.direccion) ||
          hasText(row.cargoReal) ||
          hasText(row.choraria) ||
          hasText(row.apoyoReal) ||
          hasText(row.cargoInt) ||
          hasText(row.apoyoInt) ||
          hasText(row.antig) ||
          hasText(row.inas) ||
          hasText(row.oPid) ||
          hasText(row.fecAfec),
      )
    }
    const hasAnyMeaningfulEstabRow = (bundle: ChequesBundle): boolean => {
      return bundle.liquidPorEstablecimiento.some(
        (row) =>
          row.distrito !== null ||
          hasText(row.tipoOrg) ||
          row.liquido !== null ||
          hasValue(row.numero) ||
          hasText(row.nombreEstab) ||
          hasValue(row.secu) ||
          hasText(row.perOpago) ||
          hasText(row.nombreOpago) ||
          hasText(row.fecPago),
      ) || bundle.liquidPorEstablecimiento.some((row) => hasValue(row.opid))
    }

    const normalizeDocumentoInput = (raw: string): string => {
      return raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    }
    const isValidDocumentoInput = (value: string): boolean => {
      // CUIL (11 dígitos) o DNI alfanumérico (8 caracteres).
      return /^\d{11}$/.test(value) || /^[A-Z0-9]{8}$/.test(value)
    }
    const deriveDniFromCuil = (raw: string): string | null => {
      const cleaned = normalizeCuil(raw)
      if (!/^\d{11}$/.test(cleaned)) return null
      // CUIL (11) -> DNI (8): quitamos primeros 2 y último
      return cleaned.slice(2, 10)
    }
    const normalizeRequestedDoc = (
      raw: string,
    ): { apiId: string; originalDoc: string; fromCuil: boolean } | null => {
      const cleaned = normalizeDocumentoInput(raw)
      if (!cleaned) return null

      if (/^\d{11}$/.test(cleaned)) {
        const dni = deriveDniFromCuil(cleaned)
        if (!dni) return null
        return { apiId: dni, originalDoc: cleaned, fromCuil: true }
      }

      if (!/^[A-Z0-9]{8}$/.test(cleaned)) return null
      // DNI (numérico o alfanumérico) se consulta tal cual llega (8 caracteres).
      return { apiId: cleaned, originalDoc: cleaned, fromCuil: false }
    }
    const normalizeRequestedId = (raw: string): string | null => {
      return normalizeRequestedDoc(raw)?.apiId ?? null
    }

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
            const cuils = Array.from(new Set(state.cuils.map((c) => normalizeDocumentoInput(c))))
              .map((id) => id.trim())
              .filter((id) => isValidDocumentoInput(id))

            if (cuils.length === 0) {
              return {
                error: validationError(
                  'El CSV no contiene CUIL/DNI válidos (CUIL 11 dígitos o DNI alfanumérico de 8 caracteres).',
                ),
              }
            }

            return { cuils, periodos: state.periodos }
          })()
        : (() => {
            const id = normalizeDocumentoInput(state.manualCuil)
            const isOk = isValidDocumentoInput(id)
            if (!isOk) {
              return {
                error: validationError(
                  'Ingresá un CUIL (11 dígitos) o un DNI alfanumérico válido (8 caracteres).',
                ),
              }
            }

            // Manual: períodos = state.periodos (elegidos en PeriodSelector con available vacío: sin cruce con CSV).
            return { cuils: [id], periodos: state.periodos }
          })()

    if ('error' in effective) {
      dispatch({ type: 'FETCH_ERROR', payload: effective.error as AppError })
      return
    }

    const useManualPeriods = state.queryMode !== 'batch' || state.batchUseManualPeriods
    const csvRows = state.queryMode === 'batch' ? state.csvSources.flatMap((s) => s.rows) : []
    if (useManualPeriods) {
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
    } else if (csvRows.length === 0) {
      dispatch({
        type: 'FETCH_ERROR',
        payload: validationError('El CSV no contiene filas válidas con rango de períodos para consultar.'),
      })
      return
    }

    dispatch({ type: 'FETCH_START' })
    try {
      // Si el usuario ingresa 11 dígitos asumimos CUIL, pero la API consulta por DNI.
      // Entonces: derivamos DNI (8) para consultar, y luego validamos contra el CUIL que devuelve el servicio.
      const expectedCuilsByRequestedId = new Map<string, Set<string>>() // dni -> cuil(s) ingresado(s)
      const originalDocByApiId = new Map<string, string>()
      const requestedIds: string[] = []

      for (const raw of effective.cuils) {
        const normalized = normalizeRequestedDoc(raw)
        if (!normalized) continue
        const { apiId, originalDoc, fromCuil } = normalized
        if (!originalDocByApiId.has(apiId)) {
          originalDocByApiId.set(apiId, originalDoc)
        }

        if (fromCuil) {
          const set = expectedCuilsByRequestedId.get(apiId) ?? new Set<string>()
          set.add(originalDoc)
          expectedCuilsByRequestedId.set(apiId, set)
        }

        requestedIds.push(apiId)
      }

      const uniqueRequestedIds = Array.from(new Set(requestedIds)).filter(
        (id) => isValidDocumentoInput(id),
      )
      if (uniqueRequestedIds.length === 0) {
        dispatch({
          type: 'FETCH_ERROR',
          payload: validationError(
            'No se pudo obtener un documento consultable para la API a partir de los valores ingresados.',
          ),
        })
        return
      }

      // 3) Construimos la "nómina" a partir de cheques,
      //    respetando los importes y descripciones que vienen de los endpoints.
      const items: PayrollItem[] = []
      const rawErrors: { cuil: string; message: string; periodo: string }[] = []

      // Para detectar si un documento falló en TODOS los períodos consultados.
      const totalPeriodsByCuil = new Map<string, Set<string>>()
      const errorPeriodsByCuil = new Map<string, Set<string>>()

      function registerError(cuil: string, periodo: string, message: string) {
        rawErrors.push({ cuil, message, periodo })
        const set = errorPeriodsByCuil.get(cuil) ?? new Set<string>()
        set.add(periodo)
        errorPeriodsByCuil.set(cuil, set)
      }

      // Validar 1 vez por DNI (solo para los que vienen de CUIL),
      // usando el primer período seleccionado como "probe".
      const invalidIds = new Set<string>() // ids (DNI) para los que detectamos mismatch y no consultamos más
      const mismatchReported = new Set<string>()
      const forbiddenReported = new Set<string>()
      const probePeriodo =
        useManualPeriods
          ? effective.periodos[0] ?? ''
          : (() => {
              for (const row of csvRows) {
                const range = expandYYYYMMRange(row.periodoDesde, row.periodoHasta)
                if (range.length > 0) return range[0]
              }
              return ''
            })()
      const probePeriodoYYYYMM = probePeriodo.replace('-', '')

      const idsToValidate = uniqueRequestedIds.filter((id) => expectedCuilsByRequestedId.has(id))
      // En modo lote/on-demand evitamos esta validación previa para no bloquear la consulta inicial
      // con una ronda extra de requests. Manual mantiene validación temprana por precisión.
      const shouldRunProbeValidation = state.queryMode === 'manual'
      if (shouldRunProbeValidation && idsToValidate.length > 0 && /^\d{6}$/.test(probePeriodoYYYYMM)) {
        dispatch({
          type: 'SET_FETCH_PROGRESS',
          payload: { label: 'Validando CUIL/DNI…', current: 0, total: idsToValidate.length },
        })

        let validated = 0
        await mapLimit(idsToValidate, 6, async (id) => {
          const expectedSet = expectedCuilsByRequestedId.get(id)
          if (!expectedSet || expectedSet.size === 0) return null
          const expectedList = Array.from(expectedSet).sort()

          const { rows, errors } = await fetchLiquidacionPorSecuencia(id, probePeriodoYYYYMM)
          const hasForbiddenInProbe =
            errors.some((m) => {
              const mm = m.toLowerCase()
              return (
                mm.includes('forbidden') ||
                mm.includes('http 403') ||
                mm.includes('status code 403') ||
                mm.includes('403')
              )
            }) && !forbiddenReported.has(id)

          if (hasForbiddenInProbe) {
            forbiddenReported.add(id)
            registerError(id, probePeriodo, `Acceso denegado (Forbidden/403) al validar el DNI ${id}.`)
          }
          const returnedRaw = extractCuilFromLiquidacion(rows)
          const returned = returnedRaw ? normalizeCuil(returnedRaw) : null

          // Si el servicio devuelve un CUIL, lo validamos contra los candidatos ingresados.
          // Si no devuelve CUIL, no bloqueamos (dejamos pasar para no falsear negativos).
          if (returned) {
            const isMatch = expectedSet.has(returned)
            if (!isMatch) {
              invalidIds.add(id)
              if (!mismatchReported.has(id)) {
                mismatchReported.add(id)
                registerError(
                  id,
                  probePeriodo,
                  `El/los CUIL ingresado(s) para el DNI ${id} no coinciden con el CUIL devuelto por el servicio (${returned}). Se omitió la consulta para ese DNI. Ingresados: ${expectedList.join(
                    ', ',
                  )}.`,
                )
              }
            } else if (expectedSet.size > 1 && !mismatchReported.has(id)) {
              // Caso pedido: mismo DNI con múltiples CUIL en CSV, pero uno coincide.
              mismatchReported.add(id)
              const others = expectedList.filter((c) => c !== returned)
              registerError(
                id,
                probePeriodo,
                `El DNI ${id} aparece con múltiples CUIL en el CSV. El servicio validó como correcto: ${returned}.${
                  others.length ? ` Se ignoraron: ${others.join(', ')}.` : ''
                }`,
              )
            }
          }

          validated += 1
          dispatch({
            type: 'SET_FETCH_PROGRESS',
            payload: { label: 'Validando CUIL/DNI…', current: validated, total: idsToValidate.length },
          })
          return null
        })
      }

      const validatedRequestedIds = uniqueRequestedIds.filter((id) => !invalidIds.has(id))

      // 1) A partir de los CUILs y períodos efectivos armamos todos los pares (doc + período YYYYMM).
      //    En CSV, secuencia 000 = todas; cualquier otro código de 3 dígitos filtra liquidación/liquidos.
      const pairKeys = new Set<string>()
      const validatedSet = new Set(validatedRequestedIds)
      const secuenciaFilterByKey = new Map<string, SecuenciaFilterSpec>()

      const pairs =
        state.queryMode !== 'batch'
          ? validatedRequestedIds
              .flatMap((id) =>
                effective.periodos.map((p) => {
                  const periodoYYYYMM = p.replace('-', '')
                  const key = `${id}-${periodoYYYYMM}`
                  if (pairKeys.has(key)) return null
                  pairKeys.add(key)
                  secuenciaFilterByKey.set(key, { mode: 'all' })
                  return { id, periodoYYYYMM }
                }),
              )
              .filter((p): p is { id: string; periodoYYYYMM: string } => p !== null)
          : useManualPeriods
            ? validatedRequestedIds
                .flatMap((id) =>
                  effective.periodos.map((p) => {
                    const periodoYYYYMM = p.replace('-', '')
                    const key = `${id}-${periodoYYYYMM}`
                    if (pairKeys.has(key)) return null
                    pairKeys.add(key)
                    secuenciaFilterByKey.set(
                      key,
                      resolveCsvSecuenciaFilterSpecForPair(id, periodoYYYYMM, csvRows, normalizeRequestedId),
                    )
                    return { id, periodoYYYYMM }
                  }),
                )
                .filter((p): p is { id: string; periodoYYYYMM: string } => p !== null)
            : csvRows
                .flatMap((row) => {
                  const id = normalizeRequestedId(row.documento)
                  if (!id || !validatedSet.has(id)) return []
                  const periods = expandYYYYMMRange(row.periodoDesde, row.periodoHasta)
                  const part = filterSpecFromCsvSecuencia(row.secuencia)
                  return periods.map((periodo) => {
                    const periodoYYYYMM = periodo.replace('-', '')
                    const key = `${id}-${periodoYYYYMM}`
                    if (pairKeys.has(key)) {
                      const prev = secuenciaFilterByKey.get(key) ?? { mode: 'all' }
                      secuenciaFilterByKey.set(key, mergeSecuenciaFilterSpecs(prev, part))
                      return null
                    }
                    pairKeys.add(key)
                    secuenciaFilterByKey.set(key, part)
                    return { id, periodoYYYYMM }
                  })
                })
                .filter((p): p is { id: string; periodoYYYYMM: string } => p !== null)

      if (pairs.length > ON_DEMAND_PAIR_THRESHOLD) {
        const lightweightItems: PayrollItem[] = pairs.map((p) => ({
          cuil: originalDocByApiId.get(p.id) ?? p.id,
          periodo: yyyymmToPeriod(p.periodoYYYYMM),
          concepto: 'Consulta diferida (on-demand)',
          importe: 0,
        }))
        const uniqueCuils = Array.from(new Set(lightweightItems.map((i) => i.cuil))).sort()
        const lightweightData: NormalizedPayroll = {
          items: lightweightItems,
          agents: uniqueCuils.map((cuil) => ({ cuil })),
          ...(rawErrors.length > 0
            ? {
                errors: rawErrors.map((e) => ({
                  cuil: originalDocByApiId.get(e.cuil) ?? e.cuil,
                  message: e.message,
                })),
              }
            : {}),
        }
        dispatch({ type: 'FETCH_SUCCESS', payload: lightweightData })
        return
      }

      dispatch({
        type: 'SET_FETCH_PROGRESS',
        payload: { label: 'Consultando cheques…', current: 0, total: pairs.length || 1 },
      })

      // 2) Consultamos los 3 endpoints de cheques para cada par.
      const chequesMapRaw =
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

      const chequesMap: Record<string, ChequesBundle> = {}
      for (const [key, bundle] of Object.entries(chequesMapRaw)) {
        const filt = secuenciaFilterByKey.get(key) ?? { mode: 'all' }
        const normalizedBundle = filterChequesBundleBySecuencia(bundle, filt)
        const originalDoc = originalDocByApiId.get(normalizedBundle.id)
        const visibleId = originalDoc ?? normalizedBundle.id
        const visibleBundle =
          visibleId === normalizedBundle.id ? normalizedBundle : { ...normalizedBundle, id: visibleId }
        chequesMap[`${visibleBundle.id}-${visibleBundle.periodoYYYYMM}`] = visibleBundle
      }

      Object.values(chequesMap).forEach((bundle) => {
        const periodo = `${bundle.periodoYYYYMM.slice(0, 4)}-${bundle.periodoYYYYMM.slice(4, 6)}`
        const hasMeaningfulSecuencia = hasAnyMeaningfulSecuenciaRow(bundle)
        const hasMeaningfulEstab = hasAnyMeaningfulEstabRow(bundle)

        // Registrar período consultado para este documento.
        const totalSet = totalPeriodsByCuil.get(bundle.id) ?? new Set<string>()
        totalSet.add(periodo)
        totalPeriodsByCuil.set(bundle.id, totalSet)

        // Si los 3 endpoints devuelven estructuras vacías/en blanco, lo marcamos explícitamente.
        // Evita "éxitos silenciosos" cuando en realidad el backend respondió sin contenido útil.
        if (
          !hasMeaningfulSecuencia &&
          !hasMeaningfulEstab &&
          (!bundle.errors || bundle.errors.length === 0)
        ) {
          registerError(
            bundle.id,
            periodo,
            `No se pudo obtener información para el período ${periodo}. Verificá la conectividad e intentá nuevamente.`,
          )
          return
        }

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
            'No se detectaron pagos para este período. Es posible que todavía no estén acreditados o que haya un problema en el servicio de consulta.',
          )
        }

        if (bundle.errors && bundle.errors.length > 0) {
          const hasForbidden = bundle.errors.some((m) => {
            const mm = m.toLowerCase()
            return (
              mm.includes('forbidden') ||
              mm.includes('http 403') ||
              mm.includes('status code 403') ||
              mm.includes('403')
            )
          })
          if (hasForbidden && !forbiddenReported.has(bundle.id)) {
            forbiddenReported.add(bundle.id)
            registerError(bundle.id, periodo, `Acceso denegado (Forbidden/403) al consultar el DNI ${bundle.id}.`)
          }
          bundle.errors.forEach((msg) => {
            // Si ya detectamos 403, evitamos repetir el mensaje técnico "de siempre" en el resumen.
            if (hasForbidden) {
              const mm = msg.toLowerCase()
              if (
                mm.includes('forbidden') ||
                mm.includes('http 403') ||
                mm.includes('status code 403') ||
                mm.includes('403')
              ) {
                return
              }
            }
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
          // Si el documento falló en todos los períodos, priorizamos la causa "Forbidden/403"
          // para no mostrar el genérico cuando el problema es de permisos/acceso.
          if (forbiddenReported.has(cuil)) {
            finalErrors.push({
              cuil,
              message: 'Acceso denegado (Forbidden/403).',
            })
            return
          }
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
    state.batchUseManualPeriods,
    state.queryMode,
    state.manualCuil,
    state.manualMonth,
    state.manualFrom,
    state.manualTo,
    state.availablePeriodos,
    state.csvSources,
    state.chequesByKey,
  ])

  const value = useMemo<PayrollContextValue>(
    () => ({ ...state, dispatch, consult }),
    [state, consult],
  )

  return <PayrollContext.Provider value={value}>{children}</PayrollContext.Provider>
}

