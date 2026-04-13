type RowCardProps = {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}

export function RowCard({ children, onClick, className = '' }: RowCardProps) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-4 rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-colors hover:bg-[#313131] ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
