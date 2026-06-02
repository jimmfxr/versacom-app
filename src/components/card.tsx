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
  // Full perimeter border with rounded corners — Card is always
  // rendered alone (Add / Edit forms in focus mode, settings panels)
  // so the four-sided border reads as a contained surface, not a
  // stray line. border-2 matches the dropdown / search input chrome
  // elsewhere so the focused card reads at the same visual weight.
  // px-4 keeps content from kissing the border on narrow viewports.
  return (
    <div className={`rounded-lg border-2 border-white/10 px-4 ${paddings[padding]} ${className}`}>
      {children}
    </div>
  )
}
