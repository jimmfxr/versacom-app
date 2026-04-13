type CardProps = {
  children: React.ReactNode
  className?: string
  padding?: 'sm' | 'md' | 'lg'
}

const paddings = {
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
}

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div className={`rounded-2xl bg-[#2a2a2a] ${paddings[padding]} ${className}`}>
      {children}
    </div>
  )
}
