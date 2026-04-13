type ModalProps = {
  open: boolean
  title: string
  children: React.ReactNode
  actions: React.ReactNode
}

export function Modal({ open, title, children, actions }: ModalProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-2xl bg-[#2a2a2a] p-6">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <div className="mt-2 text-sm text-gray-400">{children}</div>
        <div className="mt-5 flex items-center justify-end gap-3">{actions}</div>
      </div>
    </div>
  )
}
