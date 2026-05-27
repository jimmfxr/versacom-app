/**
 * Generic filter dropdown chip — used in place of horizontal chip
 * scrollers (Comms Equipment categories/locations, Tasks locations,
 * etc.) when there are enough options that an overflow row reads
 * worse than a single dropdown.
 *
 * Native <select> styled to match the dark form chrome.
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
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  ariaLabel: string
}) {
  return (
    <div className="relative w-36 shrink-0">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full appearance-none truncate rounded-lg border-2 border-white/10 bg-[#202020] py-2 pl-3 pr-8 text-sm text-white outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      </svg>
    </div>
  )
}
