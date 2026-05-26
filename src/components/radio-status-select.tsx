'use client'

import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import {
  RADIO_STATUSES,
  RADIO_STATUS_BORDER_STYLES,
  RADIO_STATUS_DOT_STYLES,
  getRadioStatusLabel,
  isRadioStatus,
  type RadioStatus,
} from '@/lib/radio-status'

type RadioStatusSelectProps = {
  value: string
  onChange: (next: RadioStatus) => void
  disabled?: boolean
  /** Extra classes appended to the wrapper so callers can stretch the
   *  chip (e.g. "w-full sm:w-auto" on mobile rows). */
  className?: string
}

/**
 * Radio inventory status chip — same chrome as DeployStatusSelect on
 * the Equipment side (rounded chip with tinted border + colored dot
 * + chevron, dropdown matches the trigger width via Headless UI's
 * --button-width var). Difference: a different five-state enum
 * (na / out / returned / damaged / lost) defined in lib/radio-status.
 */
export function RadioStatusSelect({
  value,
  onChange,
  disabled,
  className = '',
}: RadioStatusSelectProps) {
  const status = isRadioStatus(value) ? value : 'na'
  const borderClass = RADIO_STATUS_BORDER_STYLES[status]
  // Button is always w-full + justify-between so it fills whatever
  // width the wrapper provides — wrapper defaults to inline-block so
  // it sizes to its content; callers pass className="w-full" to
  // stretch (e.g. mobile full-width rows on the radio card).
  const buttonClass = `relative flex w-full items-center justify-center rounded-lg border ${borderClass} px-3 py-1.5 text-xs font-medium text-gray-200 outline-none transition-colors data-open:border-[#0178a3] ${
    disabled
      ? 'cursor-default opacity-60'
      : 'cursor-pointer hover:bg-white/[0.04]'
  }`

  return (
    <Listbox value={status} onChange={onChange} disabled={disabled}>
      <div className={`relative inline-block ${className}`}>
        <ListboxButton className={buttonClass}>
          {/* Fixed-width label so every status chip ("N/A", "Out",
              "Returned", "Damaged", "Lost") renders the same overall
              width — keeps the row tidy when statuses change. */}
          <span className="min-w-[4.5rem] text-center">{getRadioStatusLabel(status)}</span>
          <ChevronDownIcon className="absolute right-3 size-3" />
        </ListboxButton>
        <ListboxOptions
          transition
          anchor={{ to: 'bottom end', gap: 4 }}
          className="z-50 w-[var(--button-width)] rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl outline-none transition data-closed:scale-95 data-closed:opacity-0 data-enter:duration-150 data-enter:ease-out data-leave:duration-75 data-leave:ease-in"
        >
          {RADIO_STATUSES.map((s) => (
            <ListboxOption
              key={s.value}
              value={s.value}
              className="group flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-gray-200 transition-colors data-focus:bg-white/[0.06] data-selected:bg-[#0178a3] data-selected:text-white data-selected:data-focus:bg-[#0178a3]"
            >
              <span className={`size-2 shrink-0 rounded-full ${RADIO_STATUS_DOT_STYLES[s.value]}`} />
              <span className="flex-1 truncate">{s.label}</span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  )
}
