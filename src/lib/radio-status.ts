/**
 * Radio inventory status enum. Five states surface to the operator
 * via the status chip / dropdown on the radio Equipment card:
 *
 *   na       — default. Radio sits in inventory, hasn't entered the
 *              check-out cycle yet.
 *   out      — checked out to a person (scanner auto-sets this on
 *              an unknown-or-returned scan).
 *   returned — back in inventory after a check-out (scanner flips
 *              this on a known + currently-out scan).
 *   damaged  — physical damage, take out of rotation. Admin/manager
 *              sets manually via the dropdown.
 *   lost     — missing radio, accounting flag.
 *
 * Parallels the DeployStatus enum on the Equipment side — same chip
 * chrome, different label set / colors / semantics.
 */
export type RadioStatus = 'na' | 'out' | 'returned' | 'damaged' | 'lost'

export const RADIO_STATUSES: Array<{ value: RadioStatus; label: string }> = [
  { value: 'na', label: 'N/A' },
  { value: 'out', label: 'Out' },
  { value: 'returned', label: 'Returned' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
]

/** Outline tint for the chip — matches the DeployStatus palette so the
 *  Radio status chip reads visually consistent with the Equipment one. */
export const RADIO_STATUS_BORDER_STYLES: Record<RadioStatus, string> = {
  na: 'border-white/10',
  out: 'border-yellow-400/60',
  returned: 'border-blue-400/60',
  damaged: 'border-purple-400/60',
  lost: 'border-red-400/60',
}

/** Dot color shown next to each option inside the dropdown menu. */
export const RADIO_STATUS_DOT_STYLES: Record<RadioStatus, string> = {
  na: 'bg-gray-400',
  out: 'bg-yellow-400',
  returned: 'bg-blue-400',
  damaged: 'bg-purple-400',
  lost: 'bg-red-400',
}

export function getRadioStatusLabel(value: string): string {
  return RADIO_STATUSES.find((s) => s.value === value)?.label ?? 'N/A'
}

export function isRadioStatus(value: string): value is RadioStatus {
  return RADIO_STATUSES.some((s) => s.value === value)
}
