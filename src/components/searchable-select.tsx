'use client'

import { useState, useRef, useEffect } from 'react'

type Option = { value: string; label: string }

export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Search...',
  compact = false,
  disabled = false,
}: {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  placeholder?: string
  compact?: boolean
  /** Renders the field non-interactive (grayed out, can't focus or
   *  open). Useful when an upstream value (e.g. another field) makes
   *  this option invalid. */
  disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Snap the dropdown closed if it becomes disabled while open.
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const selectedLabel = options.find((o) => o.value === value)?.label || ''
  const filtered = options
    .filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))

  const labelClass = compact ? 'block text-[10px] font-medium text-gray-500' : 'block text-xs font-medium text-gray-400'
  const inputClass = compact
    ? 'mt-0.5 w-full rounded border border-white/10 bg-[#202020] px-2 py-1 text-base text-white outline-none focus:border-[#0178a3] disabled:cursor-not-allowed disabled:opacity-50'
    : 'mt-1 w-full rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-base text-white outline-none transition-colors focus:border-[#0178a3] disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="relative" ref={ref}>
      <label className={labelClass}>{label}</label>
      <input
        type="text"
        placeholder={selectedLabel || placeholder}
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => { if (!disabled) setOpen(true) }}
        disabled={disabled}
        className={inputClass}
      />
      {open && !disabled && (
        <div className="absolute z-10 mt-1 max-h-[11rem] w-full overflow-y-auto rounded-lg border border-white/10 bg-[#2a2a2a] shadow-lg">
          {filtered.map((o) => (
            <button
              type="button"
              key={o.value}
              onClick={() => { onChange(o.value); setSearch(o.label); setOpen(false) }}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-white/10 ${o.value === value ? 'text-[#0178a3]' : 'text-white'}`}
            >
              {o.label}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
          )}
        </div>
      )}
    </div>
  )
}
