type CardProps = {
  children: React.ReactNode
  className?: string
  padding?: 'sm' | 'md' | 'lg'
}

// Vertical-only padding — content sits flush with the page gutter
// horizontally so editor cards (Add Project, Project edit, Add
// Equipment / Team / Pick List / Plot) line up with the chip rows
// + list rows on the same surface, no inset border.
const paddings = {
  sm: 'py-4',
  md: 'py-5',
  lg: 'py-6',
}

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    // Bottom-border-only separator — same line treatment as the
    // page-header's bottomBorder + the [&>*]:border-b list pattern
    // used elsewhere. Reads as "section divider under the card"
    // rather than a fully boxed-in card.
    <div className={`border-b border-white/10 ${paddings[padding]} ${className}`}>
      {children}
    </div>
  )
}
