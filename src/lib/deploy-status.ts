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
  { value: 'done', label: 'Done' },
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

export function getStatusLabel(value: string): string {
  return DEPLOY_STATUSES.find((s) => s.value === value)?.label ?? 'N/A'
}
