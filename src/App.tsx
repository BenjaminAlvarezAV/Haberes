import { PayrollProvider } from './features/payroll/PayrollProvider'
import { PayrollPage } from './features/payroll/PayrollPage'

export default function App() {
  return (
    <PayrollProvider>
      <PayrollPage />
    </PayrollProvider>
  )
}
