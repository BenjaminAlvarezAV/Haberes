import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        className="absolute inset-0 h-full w-full bg-black/40"
        onClick={onClose}
        aria-label="Cerrar modal"
      />
      <div className="relative z-10 w-full max-w-5xl rounded-xl bg-white shadow-xl ring-1 ring-gray-200">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-gray-100"
          >
            Cerrar
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
