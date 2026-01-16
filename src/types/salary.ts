export interface SalaryRecord {
  id: string
  cuil: string
  periodo: string
  monto: number
  detalle: string
}

export interface Teacher {
  cuil: string
  nombre?: string
}
