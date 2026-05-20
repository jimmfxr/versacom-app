/**
 * Single source of truth for deploy status values, labels, and badge colors.
 *
 * Used by:
 *  - the equipment list on the project detail page (admin can change status)
 *  - the My Equipment page (read-only badge for end users)
 *  - the DeployStatusSelect dropdown component
 */

export const DEPLOY_STATUSES = [
  { value: 'na', label: 'N/A' },
  { value: 'deployed', label: 'Deployed' },
  // DB value stays 'done' for backwards-compat; we only changed the
  // user-facing label to "Faxed" to match the team's actual workflow.
  { value: 'done', label: 'Faxed' },
  { value: 'returned', label: 'Returned' },
  { value: 'not-needed', label: 'Not Needed' },
  { value: 'damaged', label: 'Damaged' },
] as const

export type DeployStatus = (typeof DEPLOY_STATUSES)[number]['value']

/** Tailwind classes — soft tinted background + matching text. */
export const STATUS_BADGE_STYLES: Record<string, string> = {
  na: 'bg-gray-500/15 text-gray-400',
  deployed: 'bg-yellow-500/15 text-yellow-400',
  done: 'bg-green-500/15 text-green-400',
  returned: 'bg-blue-500/15 text-blue-400',
  'not-needed': 'bg-red-500/15 text-red-400',
  damaged: 'bg-purple-500/15 text-purple-400',
}

/** Solid color for the small dot beside each option in the dropdown. */
export const STATUS_DOT_STYLES: Record<string, string> = {
  na: 'bg-gray-400',
  deployed: 'bg-yellow-400',
  done: 'bg-green-400',
  returned: 'bg-blue-400',
  'not-needed': 'bg-red-400',
  damaged: 'bg-purple-400',
}

/** Border color for the status chip — replaces the colored dot. N/A
 *  keeps the neutral white/10 chip border so it reads as "no status";
 *  every other status tints the chip outline. */
export const STATUS_BORDER_STYLES: Record<string, string> = {
  na: 'border-white/10',
  deployed: 'border-yellow-400/60',
  done: 'border-green-400/60',
  returned: 'border-blue-400/60',
  'not-needed': 'border-red-400/60',
  damaged: 'border-purple-400/60',
}

export function getStatusLabel(value: string): string {
  return DEPLOY_STATUSES.find((s) => s.value === value)?.label ?? 'N/A'
}
