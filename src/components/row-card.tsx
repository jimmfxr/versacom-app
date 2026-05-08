type RowCardProps = {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}

export function RowCard({ children, onClick, className = '' }: RowCardProps) {
  // Tappable rows get the same press feedback as the mobile nav cards
  // (cyan flash) so the tap is visibly acknowledged on touch devices,
  // where :hover doesn't reliably fire. Static rows skip it.
  const interactive = onClick
    ? 'cursor-pointer hover:bg-white/[0.04] active:bg-[#0178a3]/20'
    : ''

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-4 px-5 py-3 transition-colors duration-100 ${interactive} ${className}`}
    >
      {children}
    </div>
  )
}
