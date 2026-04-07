import type { ReactNode } from 'react'

export function Card({
  title,
  children,
  className = '',
}: {
  title?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-xl bg-surface p-5 shadow-[var(--app-shadow)] ring-1 ring-outline-variant ${className}`}
    >
      {title ? <h2 className="mb-4 text-base font-semibold text-on-surface">{title}</h2> : null}
      {children}
    </section>
  )
}
