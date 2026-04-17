'use client'

import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react'
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/24/outline'
import {
  DEPLOY_STATUSES,
  STATUS_BADGE_STYLES,
  STATUS_DOT_STYLES,
  getStatusLabel,
} from '@/lib/deploy-status'

type DeployStatusSelectProps = {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}

/**
 * Status pill that opens a polished dropdown when clicked. Replaces the
 * native <select> with a Headless UI Listbox so we can match the rest of
 * the app's dark dropdowns (rounded panel, subtle hover, cyan accent on
 * the current selection, animated open/close).
 */
export function DeployStatusSelect({ value, onChange, disabled }: DeployStatusSelectProps) {
  const buttonClass = `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium outline-none transition-opacity ${
    STATUS_BADGE_STYLES[value] || STATUS_BADGE_STYLES.na
  } ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer hover:opacity-90'}`

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <div className="relative">
        <ListboxButton className={buttonClass}>
          {getStatusLabel(value)}
          <ChevronDownIcon className="size-3" />
        </ListboxButton>
        <ListboxOptions
          transition
          anchor={{ to: 'bottom end', gap: 4 }}
          className="z-50 w-44 rounded-lg border border-white/10 bg-[#2a2a2a] py-1 shadow-lg outline-none transition data-closed:scale-95 data-closed:opacity-0 data-enter:duration-150 data-enter:ease-out data-leave:duration-75 data-leave:ease-in"
        >
          {DEPLOY_STATUSES.map((s) => (
            <ListboxOption
              key={s.value}
              value={s.value}
              className="group flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-gray-300 transition-colors data-focus:bg-white/5 data-selected:text-[#0178a3]"
            >
              <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT_STYLES[s.value]}`} />
              <span className="flex-1">{s.label}</span>
              <CheckIcon className="size-4 opacity-0 group-data-selected:opacity-100" />
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  )
}
