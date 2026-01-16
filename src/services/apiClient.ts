import axios, { AxiosError } from 'axios'
import type { AppError } from '../types/errors'

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
})

export function toAppError(err: unknown): AppError {
  if (err instanceof AxiosError) {
    const status = err.response?.status
    if (!err.response) {
      return { kind: 'network', message: 'No se pudo conectar con el servidor', cause: err }
    }
    const message =
      typeof err.response.data === 'object' && err.response.data && 'message' in err.response.data
        ? String((err.response.data as { message: unknown }).message)
        : `Error HTTP ${status ?? ''}`.trim()

    return { kind: 'http', message, status, cause: err }
  }

  if (err instanceof Error) return { kind: 'unknown', message: err.message, cause: err }
  return { kind: 'unknown', message: 'Error desconocido', cause: err }
}
