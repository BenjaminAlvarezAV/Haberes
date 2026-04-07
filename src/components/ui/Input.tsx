import type { InputHTMLAttributes } from 'react'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-10 w-full rounded-md border border-outline-variant bg-input-bg px-3 text-sm text-on-surface shadow-[var(--app-shadow)] placeholder:text-on-surface-variant/55 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 ${className}`}
      {...props}
    />
  )
}
