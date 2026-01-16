export type AppErrorKind = 'network' | 'http' | 'validation' | 'unknown'

export interface AppError {
  kind: AppErrorKind
  message: string
  status?: number
  cause?: unknown
}
