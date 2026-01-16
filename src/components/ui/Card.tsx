import type { ReactNode } from 'react'

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
      {title ? <h2 className="mb-4 text-base font-semibold text-gray-900">{title}</h2> : null}
      {children}
    </section>
  )
}
