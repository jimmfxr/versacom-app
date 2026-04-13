const COLORS: Record<string, string> = {
  green: 'bg-green-500/15 text-green-400',
  red: 'bg-red-500/15 text-red-400',
  amber: 'bg-amber-500/15 text-amber-400',
  blue: 'bg-blue-500/15 text-blue-400',
  purple: 'bg-purple-500/15 text-purple-400',
  yellow: 'bg-yellow-500/15 text-yellow-400',
  gray: 'bg-gray-500/15 text-gray-400',
}

type StatusBadgeProps = {
  label: string
  color: keyof typeof COLORS
}

export function StatusBadge({ label, color }: StatusBadgeProps) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${COLORS[color] || COLORS.gray}`}>
      {label}
    </span>
  )
}
