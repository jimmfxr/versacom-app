type RowCardProps = {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}

export function RowCard({ children, onClick, className = '' }: RowCardProps) {
  // Tappable rows get the same press feedback as the mobile nav cards
  // (scale-down + cyan flash) so the tap is visibly acknowledged on touch
  // devices, where :hover doesn't reliably fire. Static rows skip it.
  const interactive = onClick
    ? 'cursor-pointer hover:bg-[#313131] active:scale-[0.97] active:bg-[#0178a3]/20'
    : ''

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-4 rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-all duration-100 ${interactive} ${className}`}
    >
      {children}
    </div>
  )
}
