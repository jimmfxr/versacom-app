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
  // No bottom border — Cards are always rendered alone (Add / Edit
  // forms in focus mode, settings panels). The previous border-b
  // bled in below the card when nothing was beneath it, reading
  // as a stray line under the form.
  return (
    <div className={`${paddings[padding]} ${className}`}>
      {children}
    </div>
  )
}
