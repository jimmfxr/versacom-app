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
  // Index of the option currently highlighted by arrow-key navigation.
  // -1 means "no highlight yet" — first ArrowDown moves to 0.
  const [highlight, setHighlight] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    // Close the dropdown the moment focus moves outside this component
    // — this is what makes Tab to the next form field cleanly close
    // the suggestions panel. More reliable than onBlur+relatedTarget.
    function handleFocusIn(e: FocusEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [])

  // Reset the keyboard highlight whenever the dropdown opens or the
  // filtered list shifts so arrow keys start from the top.
  useEffect(() => {
    if (open) setHighlight(-1)
  }, [open, value])

  // Filter suggestions by the current typed value (case-insensitive substring), then A–Z sort
  const filtered = options
    .filter((o) => !value || o.toLowerCase().includes(value.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

  // Keep the highlighted suggestion in view while arrow-keying.
  useEffect(() => {
    if (!open || highlight < 0) return
    listRef.current?.querySelector<HTMLButtonElement>(`[data-idx="${highlight}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      if (filtered.length === 0) return
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setHighlight((h) => (h + 1 >= filtered.length ? 0 : h + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      if (filtered.length === 0) return
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setHighlight((h) => (h <= 0 ? filtered.length - 1 : h - 1))
      return
    }
    if (e.key === 'Enter') {
      // First Enter: if a suggestion is highlighted, lock it in and
      // keep focus on the input. Stop propagation so the surrounding
      // <form>'s Enter-to-save doesn't fire on the same press.
      if (open && highlight >= 0 && highlight < filtered.length) {
        e.preventDefault()
        e.stopPropagation()
        onChange(filtered[highlight])
        setOpen(false)
        return
      }
      // No highlight (free-text typed): just close the suggestions and
      // let Enter bubble so the parent form can submit normally.
      if (open) setOpen(false)
      onKeyDown?.(e)
      return
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        return
      }
      // Already closed — let Esc bubble so the parent can cancel.
      onKeyDown?.(e)
      return
    }
    onKeyDown?.(e)
  }

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
        onKeyDown={handleKeyDown}
        className={inputClass}
      />
      {open && filtered.length > 0 && (
        <div ref={listRef} className="absolute z-10 mt-1 max-h-[11rem] w-full overflow-y-auto rounded-lg border border-white/10 bg-[#2a2a2a] shadow-lg">
          {filtered.map((o, idx) => {
            const isSelected = o.toLowerCase() === value.toLowerCase()
            const isHighlight = idx === highlight
            // Selected wins (full cyan + white) so the active value
            // always reads the same regardless of where the keyboard
            // highlight is. Matches SearchableSelect's option styling.
            const stateClass = isSelected
              ? 'bg-[#0178a3] text-white'
              : isHighlight
                ? 'bg-white/[0.08] text-white'
                : 'text-white hover:bg-white/10'
            return (
              <button
                type="button"
                key={o}
                data-idx={idx}
                tabIndex={-1}
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => { onChange(o); setOpen(false) }}
                className={`w-full px-3 py-2 text-left text-sm font-medium ${stateClass}`}
              >
                {o}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
