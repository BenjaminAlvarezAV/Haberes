import { PayrollProvider } from './features/payroll/PayrollProvider'
import { PayrollPage } from './features/payroll/PayrollPage'
import { ThemeProvider } from './theme/ThemeContext'

export default function App() {
  return (
    <ThemeProvider>
      <PayrollProvider>
        <PayrollPage />
      </PayrollProvider>
    </ThemeProvider>
  )
}
