type ModalProps = {
  open: boolean
  title: string
  children: React.ReactNode
  /** Optional. Action-row buttons (Cancel / Delete / etc.) shown at
   *  the bottom of the modal. Omit when the modal only needs an X
   *  in the corner (e.g. read-only displays like the join-QR modal). */
  actions?: React.ReactNode
  /** Optional. When provided, an X close button is rendered in the
   *  top-right corner of the modal and tapping it / the backdrop
   *  fires this callback. */
  onClose?: () => void
}

export function Modal({ open, title, children, actions, onClose }: ModalProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl bg-[#2a2a2a] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="mt-2 text-sm text-gray-400">{children}</div>
        {actions && <div className="mt-5 flex items-center justify-end gap-3">{actions}</div>}
      </div>
    </div>
  )
}
