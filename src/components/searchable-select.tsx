'use client'

import { useState, useRef, useEffect } from 'react'

type Option = {
  value: string
  /** Plain-text label — used for the trigger's placeholder display
   *  AND as the haystack for search filtering. Keep it descriptive
   *  enough that typing any part of it surfaces the option. */
  label: string
  /** Optional rich JSX shown inside the dropdown list row, when you
   *  want parts of the label tinted differently (e.g. a creator name
   *  in cyan). Falls back to `label` when omitted. The plain `label`
   *  is still what drives search + the selected-state placeholder. */
  displayLabel?: React.ReactNode
}

export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Search...',
  compact = false,
  disabled = false,
}: {
  /** Optional label rendered above the trigger. Omit to render the
   *  field without a visible label (useful inside dense rows like
   *  the mult strand list where another control already labels the
   *  row). */
  label?: string
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
  // Index of the option currently highlighted for keyboard navigation.
  // -1 when there's no highlight yet (e.g. dropdown just opened).
  const [highlight, setHighlight] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    // Global focusin listener — closes the dropdown the moment focus
    // moves OUTSIDE this component, which is what makes Tab-to-next-
    // input work cleanly. We listen on document so it catches focus
    // changes anywhere in the page; relying on the input's onBlur is
    // unreliable across browsers because relatedTarget is sometimes
    // null on Tab.
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

  // Snap the dropdown closed if it becomes disabled while open.
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  // Reset highlight whenever the dropdown opens / search changes so
  // arrow keys start from the top of the visible list.
  useEffect(() => {
    if (open) setHighlight(-1)
  }, [open, search])

  const selectedLabel = options.find((o) => o.value === value)?.label || ''
  const filtered = options
    .filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()))
    // `numeric: true` makes "2, 4, 12, 24, 48, 76" sort in natural order
    // (treats embedded digits as numbers) — without it, plain localeCompare
    // gives string order "12, 2, 24, 4, 48, 76".
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }))

  // Keep the highlighted row in view as the user arrows through. Need
  // the actual <button> nodes — query by data-attr is simplest.
  useEffect(() => {
    if (!open || highlight < 0) return
    const list = listRef.current
    if (!list) return
    const node = list.querySelector<HTMLButtonElement>(`[data-idx="${highlight}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return
    // Tab moves focus to the next field via the browser's default. We
    // close the panel synchronously here so it doesn't flash visible
    // for a frame while focus transitions — the previous path relied
    // on the global focusin listener, which fires after the browser
    // repaints with the new focus state.
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    // ArrowDown opens the menu (if closed) and moves the highlight.
    if (e.key === 'ArrowDown') {
      e.preventDefault() // stop the page from scrolling
      if (!open) { setOpen(true); return }
      if (filtered.length === 0) return
      setHighlight((h) => (h + 1 >= filtered.length ? 0 : h + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      if (filtered.length === 0) return
      setHighlight((h) => (h <= 0 ? filtered.length - 1 : h - 1))
      return
    }
    if (e.key === 'Enter') {
      // First Enter: if dropdown is open and there's a highlighted item,
      // lock it in and keep focus on the field. We stop propagation so
      // the surrounding <form>'s onSubmit doesn't fire on the same Enter.
      if (open && highlight >= 0 && highlight < filtered.length) {
        const o = filtered[highlight]
        onChange(o.value)
        setSearch(o.label)
        setOpen(false)
        e.preventDefault()
        e.stopPropagation()
      }
      // If dropdown is closed (or nothing highlighted), let Enter bubble
      // to the form so the parent's Save handler runs as usual.
      return
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
      // If already closed, let Esc bubble to cancel the card edit.
      return
    }
  }

  // compact = true keeps a tighter label-row (smaller label text, less
  // top margin) so packed grids still feel dense, but the input itself
  // matches the standard 'px-3 py-2 text-base' size used elsewhere so
  // it's not visually smaller than the action buttons in the same form.
  const labelClass = compact ? 'block text-[10px] font-medium text-gray-500' : 'block text-xs font-medium text-gray-400'
  const inputClass = compact
    ? 'mt-0.5 w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-base text-white outline-none focus:border-[#0178a3] disabled:cursor-not-allowed disabled:opacity-50'
    : 'mt-1 w-full rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-base text-white outline-none transition-colors focus:border-[#0178a3] disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="relative" ref={ref}>
      {label && <label className={labelClass}>{label}</label>}
      <input
        type="text"
        placeholder={selectedLabel || placeholder}
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
        // Click opens the dropdown — but Tab focus does NOT, so the
        // user can tab past this field without a menu popping up.
        // Typing or ArrowDown / ArrowUp also opens it (see onChange +
        // handleKeyDown). Closing on focus-out is handled by the
        // global focusin listener above.
        onClick={() => { if (!disabled) setOpen(true) }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={inputClass}
      />
      {open && !disabled && (
        <div ref={listRef} className="absolute z-10 mt-1 max-h-[11rem] w-full overflow-y-auto rounded-lg border border-white/10 bg-[#2a2a2a] shadow-lg">
          {filtered.map((o, idx) => {
            const isHighlight = idx === highlight
            const isSelected = o.value === value
            // Selected wins (full cyan + white) so the selected option
            // always reads the same regardless of where the keyboard
            // highlight is. Non-selected options just show a subtle
            // gray hover/highlight band.
            const stateClass = isSelected
              ? 'bg-[#0178a3] text-white'
              : isHighlight
                ? 'bg-white/[0.08] text-white'
                : 'text-white hover:bg-white/10'
            return (
              <button
                type="button"
                key={o.value}
                data-idx={idx}
                // tabIndex=-1 keeps the dropdown's option buttons out of
                // the form's Tab order — Tab inside the search input
                // jumps to the next form field instead of stepping
                // through every option. Arrow keys + Enter are the
                // intended way to pick an option.
                tabIndex={-1}
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => { onChange(o.value); setSearch(o.label); setOpen(false) }}
                className={`w-full px-3 py-2 text-left text-sm font-medium ${stateClass}`}
              >
                {o.displayLabel ?? o.label}
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
          )}
        </div>
      )}
    </div>
  )
}
