import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50'
  const styles: Record<Variant, string> = {
    primary: 'bg-primary text-on-primary hover:bg-primary-hover',
    secondary:
      'bg-surface-tonal text-on-surface ring-1 ring-outline hover:bg-ghost-hover',
    ghost: 'bg-transparent text-on-surface hover:bg-ghost-hover',
  }

  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />
}
