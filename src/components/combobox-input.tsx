'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Free-text input with a searchable suggestion dropdown.
 * Unlike SearchableSelect, the user can type any value, not just pick from options.
 * Options serve as suggestions only — the bound value is whatever the user typed.
 */
export function ComboboxInput({
  label,
  value,
  options,
  onChange,
  placeholder,
  compact = false,
  autoFocus = false,
  id,
  onKeyDown,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  placeholder?: string
  compact?: boolean
  autoFocus?: boolean
  /** DOM id on the underlying input — used by callers that need to focus it. */
  id?: string
  /** Forwarded to the input so callers can intercept Enter / Escape / etc. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Filter suggestions by the current typed value (case-insensitive substring), then A–Z sort
  const filtered = options
    .filter((o) => !value || o.toLowerCase().includes(value.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

  const labelClass = compact
    ? 'block text-[10px] font-medium text-gray-500'
    : 'block text-xs font-medium text-gray-400'
  const inputClass = compact
    ? 'mt-0.5 w-full rounded border border-white/10 bg-[#202020] px-2 py-1 text-base text-white outline-none focus:border-[#0178a3]'
    : 'mt-1 w-full rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-base text-white outline-none transition-colors focus:border-[#0178a3]'

  return (
    <div className="relative" ref={ref}>
      <label className={labelClass}>{label}</label>
      <input
        type="text"
        id={id}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          // Close the suggestions on Enter so the parent's submit handler
          // (or whatever onKeyDown does) runs cleanly.
          if (e.key === 'Enter') setOpen(false)
          if (e.key === 'Escape') setOpen(false)
          onKeyDown?.(e)
        }}
        className={inputClass}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-[11rem] w-full overflow-y-auto rounded-lg border border-white/10 bg-[#2a2a2a] shadow-lg">
          {filtered.map((o) => (
            <button
              type="button"
              key={o}
              onClick={() => { onChange(o); setOpen(false) }}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-white/10 ${o.toLowerCase() === value.toLowerCase() ? 'text-[#0178a3]' : 'text-white'}`}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
