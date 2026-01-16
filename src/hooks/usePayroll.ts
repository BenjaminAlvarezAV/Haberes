import { useContext } from 'react'
import type { PayrollContextValue } from '../features/payroll/PayrollContext'
import { PayrollContext } from '../features/payroll/PayrollContext'

export function usePayroll(): PayrollContextValue {
  const ctx = useContext(PayrollContext)
  if (!ctx) throw new Error('usePayroll debe usarse dentro de PayrollProvider')
  return ctx
}
