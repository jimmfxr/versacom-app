'use client'

import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import {
  DEPLOY_STATUSES,
  STATUS_BORDER_STYLES,
  STATUS_DOT_STYLES,
  getStatusLabel,
} from '@/lib/deploy-status'

type DeployStatusSelectProps = {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  /** Extra classes appended to the trigger button — e.g. "w-full" so
   *  the chip stretches to fill its container on mobile layouts. */
  className?: string
}

/**
 * Status chip that opens a polished dropdown when clicked. Replaces the
 * native <select> with a Headless UI Listbox so the trigger matches the
 * chip-inactive chrome used everywhere else (Edit, Returned, Cancel
 * buttons, project switchers): thin white/10 border, transparent fill,
 * gray-200 text, hover bumps the border, open flips to cyan border.
 * The current status is conveyed by a small colored dot inline rather
 * than tinting the whole pill, so the chip stays visually consistent
 * with its neighbors.
 */
export function DeployStatusSelect({ value, onChange, disabled, className = '' }: DeployStatusSelectProps) {
  // Status is conveyed by tinting the chip's border in the matching
  // status color (yellow=deployed, green=done, etc.). N/A falls back
  // to the neutral white/10 chip border so unstatused rows blend in.
  const borderClass = STATUS_BORDER_STYLES[value] || STATUS_BORDER_STYLES.na
  // Button is always w-full + justify-between so it fills whatever
  // width the wrapper gives it. The wrapper defaults to inline-block
  // (content-sized) — pass className="w-full" etc. on the caller to
  // stretch the chip across its container (e.g. mobile rows).
  // Button: flex w-full so it fills its wrapper. Label centers, chevron
  // is anchored absolutely on the right edge so it doesn't push the label
  // off-center when the chip is stretched (mobile full-width case). On
  // desktop the wrapper is content-sized, the label centers in a small
  // box, and the chevron sits just inside the right border — same look
  // as before.
  const buttonClass = `relative flex w-full items-center justify-center rounded-lg border ${borderClass} px-3 py-1.5 text-xs font-medium text-gray-200 outline-none transition-colors data-open:border-[#0178a3] ${
    disabled
      ? 'cursor-default opacity-60'
      : 'cursor-pointer hover:bg-white/[0.04]'
  }`

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <div className={`relative inline-block ${className}`}>
        <ListboxButton className={buttonClass}>
          {/* Fixed-width label so every status chip ("N/A", "Done",
              "Not Needed", "Damaged"…) renders at the same overall
              width — keeps the row tidy when statuses change. */}
          <span className="min-w-[4.5rem] text-center">{getStatusLabel(value)}</span>
          <ChevronDownIcon className="absolute right-3 size-3" />
        </ListboxButton>
        <ListboxOptions
          transition
          anchor={{ to: 'bottom end', gap: 4 }}
          // Panel width tracks the chip trigger via the
          // --button-width CSS variable Headless UI exposes on the
          // anchor. Matches the PickerSelect / ProjectSwitcher
          // pattern where the dropdown is exactly the trigger width.
          className="z-50 w-[var(--button-width)] rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl outline-none transition data-closed:scale-95 data-closed:opacity-0 data-enter:duration-150 data-enter:ease-out data-leave:duration-75 data-leave:ease-in"
        >
          {DEPLOY_STATUSES.map((s) => (
            <ListboxOption
              key={s.value}
              value={s.value}
              // Row geometry tuned to the chip trigger width: tighter
              // padding (px-2.5, gap-2 instead of the px-3 gap-3 used
              // in the bigger ProjectSwitcher/MemberSwitcher dropdowns)
              // so labels fit when the panel is sized to the chip.
              // Selected = solid cyan + white text; hover/focus =
              // subtle white tint. text-xs to match the chip itself.
              className="group flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-gray-200 transition-colors data-focus:bg-white/[0.06] data-selected:bg-[#0178a3] data-selected:text-white data-selected:data-focus:bg-[#0178a3]"
            >
              <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT_STYLES[s.value]}`} />
              <span className="flex-1 truncate">{s.label}</span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  )
}
