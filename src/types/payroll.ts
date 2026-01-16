export interface PayrollItem {
  cuil: string
  periodo: string // "YYYY-MM"
  concepto: string
  importe: number
  tipo?: string
}

export interface Agent {
  cuil: string
  nombre?: string
}

export interface NormalizedPayroll {
  items: PayrollItem[]
  agents: Agent[]
  errors?: { cuil: string; message: string }[]
}

export type GroupMode = 'agent' | 'period'
