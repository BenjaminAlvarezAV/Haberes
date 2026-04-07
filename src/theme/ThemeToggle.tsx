import type { ThemeChoice } from './ThemeContext'
import { useTheme } from './ThemeContext'

const options: { value: ThemeChoice; label: string; title: string }[] = [
  { value: 'light', label: 'Claro', title: 'Tema claro' },
  { value: 'dark', label: 'Oscuro', title: 'Tema oscuro' },
]

export function ThemeToggle() {
  const { resolved, setTheme } = useTheme()

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-outline bg-surface-tonal p-0.5"
      role="group"
      aria-label="Tema de la interfaz"
    >
      {options.map((opt) => {
        const on = resolved === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            onClick={() => setTheme(opt.value)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              on
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:bg-ghost-hover'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
