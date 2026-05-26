// Chip-bordered status badge — same chrome as the deploy-status chips
// on Project Details and the Active/Archived chips on the project list:
// rounded-lg, thin tinted border, gray-200 text. The color prop tints
// only the border so the badge sits visually next to the chip-inactive
// buttons (Edit, Returned, Cancel) used elsewhere in the row.
const BORDERS: Record<string, string> = {
  green: 'border-green-400/60',
  red: 'border-red-400/60',
  amber: 'border-amber-400/60',
  blue: 'border-blue-400/60',
  purple: 'border-purple-400/60',
  yellow: 'border-yellow-400/60',
  gray: 'border-white/10',
}

type StatusBadgeProps = {
  label: string
  color: keyof typeof BORDERS
}

export function StatusBadge({ label, color }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium text-gray-200 ${BORDERS[color] || BORDERS.gray}`}>
      {label}
    </span>
  )
}
