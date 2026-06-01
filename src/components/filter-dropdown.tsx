'use client'

import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react'
import { ChevronDownIcon } from '@heroicons/react/24/outline'

/**
 * Generic filter dropdown chip — used in place of horizontal chip
 * scrollers (Comms Equipment categories/locations, Tasks locations,
 * dashboard Department, etc.) when there are enough options that an
 * overflow row reads worse than a single dropdown.
 *
 * Built on Headless UI Listbox so the chip opens a polished dark
 * popover directly below the trigger (matching ProjectSwitcher and
 * the status selects). Native <select> elements were too OS-themed
 * and didn't reliably open in-context on mobile, so we render our
 * own panel.
 *
 * Width: w-36 — narrow chip-style sizing so multiple dropdowns can
 * sit side-by-side on the far left of a row without dominating the
 * available width. Caller is responsible for layout (flex-row + gap).
 * Border-2 matches the thickness used by the search input + other
 * chip controls on the same rows.
 */
export function FilterDropdown({
  value,
  onChange,
  options,
  ariaLabel,
  /** Tailwind classes for the wrapper width / shrink behavior.
   *  Default keeps the v2.3 chip sizing (w-36 fixed). Callers that
   *  need a different mobile width (e.g. 50/50 splits on Comms
   *  filter rows) override this with something like
   *  "flex-1 sm:flex-none sm:w-36" or "w-1/2 sm:w-36 sm:shrink-0". */
  widthClass = 'w-36 shrink-0',
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  ariaLabel: string
  widthClass?: string
}) {
  const current = options.find((o) => o.value === value)
  return (
    <Listbox value={value} onChange={onChange}>
      <div className={`relative ${widthClass}`}>
        <ListboxButton
          aria-label={ariaLabel}
          className="flex w-full items-center justify-between gap-2 truncate rounded-lg border-2 border-white/10 bg-[#202020] py-2 pl-3 pr-2.5 text-sm text-white outline-none transition-colors hover:border-white/20 focus:border-[#0178a3] data-open:border-[#0178a3]"
        >
          <span className="truncate">{current?.label ?? options[0]?.label ?? ''}</span>
          <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-gray-400" />
        </ListboxButton>
        <ListboxOptions
          transition
          anchor={{ to: 'bottom start', gap: 4 }}
          // Panel width tracks the chip via Headless UI's
          // --button-width CSS variable so the popover lines up
          // exactly under the trigger. Dark chrome + border + shadow
          // matches ProjectSwitcher / status selects.
          className="z-[300] w-[var(--button-width)] rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl outline-none transition data-closed:scale-95 data-closed:opacity-0 data-enter:duration-150 data-enter:ease-out data-leave:duration-75 data-leave:ease-in"
        >
          {options.map((o) => (
            <ListboxOption
              key={o.value}
              value={o.value}
              // Active option (the one currently selected) fills
              // solid cyan with white text — matches the nav-link
              // press chip / mobile nav active state. Hover
              // (data-focus) lights the row neutrally so it doesn't
              // compete with the selected state.
              className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm text-gray-200 outline-none transition-colors data-focus:bg-white/[0.06] data-selected:bg-[#0178a3] data-selected:text-white"
            >
              <span className="truncate">{o.label}</span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  )
}
