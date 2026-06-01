'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useLayoutEffect } from 'react'

/**
 * Rack designer — the page-level UI for a single RackTemplate.
 *
 * v1 scope: read-only visualization.
 *   - Chassis card with bordered RU column (1 at top → totalRU at bottom).
 *   - Each RackSlot renders as a row spanning its `ruSize` RUs.
 *   - Empty RUs show a "click drag and drop here" placeholder.
 *   - Front / Rear dropdown flips which side's slots are visible.
 *   - Back button returns to the project's Comms Racks tab.
 *
 * v2 will layer in: the device library aside, drag-and-drop, inline
 * slot edit, the loose-gear tray, and custom-device CRUD. Those land
 * in follow-up commits so each layer can be reviewed independently.
 */

type Slot = {
  id: number
  ruPosition: number
  ruSize: number
  side: string // 'front' | 'rear'
  deviceType: string
  label: string
  color: string | null
  equipmentId: number | null
}

type LooseItem = {
  id: number
  deviceType: string
  label: string | null
  equipmentId: number | null
}

const RU_PX = 48 // matches the preview mockup — 1RU = 48px tall

export function RackDesigner({
  project,
  rack,
  slots,
  looseItems,
  canEdit,
}: {
  project: { id: number; name: string }
  rack: {
    id: number
    name: string
    description: string | null
    location: string | null
    totalRU: number
    dept: string
  }
  slots: Slot[]
  looseItems: LooseItem[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [side, setSide] = useState<'front' | 'rear'>('front')
  // canEdit is hooked up here so a future commit can switch read-only
  // affordances on without restructuring. v1 visualization is read-only
  // regardless — no inputs to gate.
  void canEdit

  const sideSlots = slots.filter((s) => s.side === side)
  const occupied = new Set<number>()
  for (const s of sideSlots) {
    for (let i = 0; i < s.ruSize; i++) occupied.add(s.ruPosition + i)
  }
  const usedRU = sideSlots.reduce((acc, s) => acc + s.ruSize, 0)

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-5 pb-28 sm:pb-8 min-h-0 flex-1 flex flex-col">

      {/* ─── Page header ───
          Back button (returns to the Comms Racks tab) + rack name +
          location. Mirrors the panel-studio "Back" pattern so the
          chrome reads the same. */}
      <header className="flex flex-row items-center justify-between gap-3 border-b border-white/20 pb-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white truncate">
            {rack.name}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            {rack.location && (
              <>
                <span className="text-gray-300">{rack.location}</span>
                <span className="text-gray-600">·</span>
              </>
            )}
            <span>{rack.totalRU}RU</span>
            <span className="text-gray-600">·</span>
            <span className="text-gray-300">{project.name}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/projects/${project.id}?tab=racks`)}
          className="shrink-0 rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
        >
          Back
        </button>
      </header>

      {/* ─── Toolbar: side picker (left-cluster) ───
          Matches the racks-ui-preview layout: rack-context controls
          on the far left, tab-/search-style controls on the far
          right (none yet on this page). */}
      <div className="flex items-center gap-3 flex-wrap py-4">
        <div className="w-[140px]">
          <SideDropdown value={side} onChange={setSide} />
        </div>
        <div className="flex-1" />
      </div>

      {/* ─── Stats line ─── */}
      <div className="text-xs text-gray-500 mb-3">
        <span className="text-gray-300">{rack.name}</span>
        <span className="mx-1 text-gray-600">·</span>
        <span>{rack.totalRU}RU</span>
        <span className="mx-1 text-gray-600">·</span>
        <span>{side === 'front' ? 'Front view' : 'Rear view'}</span>
        <span className="mx-1 text-gray-600">·</span>
        <span>{usedRU} of {rack.totalRU} RUs used</span>
      </div>

      {/* ─── Loose gear tray (above the rack) ───
          Read-only chips in v1. No border / background — quiet meta
          strip, mirrors the racks-ui-preview design. */}
      {looseItems.length > 0 && (
        <div className="mb-3 flex-shrink-0">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Loose gear · no RU</div>
            <div className="text-[10px] text-gray-600">velcro / drawer</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {looseItems.map((g) => (
              <div
                key={g.id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#2a2a2a] border border-white/10 text-xs text-gray-200"
              >
                {g.label || g.deviceType}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Rack visualization ───
          Bordered chassis containing the RU column. Slots are
          absolute-positioned at their RU rows; empty rows render in
          the same row grid with the bottom-border-only style from the
          mockup. Scrolls inside the bounded height so a tall rack
          doesn't push other chrome offscreen. */}
      <div className="relative rounded-lg border border-white/15 p-2 overflow-y-auto max-h-[calc(100vh-320px)]">
        <div className="relative" style={{ height: `${rack.totalRU * RU_PX + 8}px` }}>
          {/* Empty rows + RU numbers — full grid first, slots layer on top */}
          {Array.from({ length: rack.totalRU }, (_, i) => {
            const ru = i + 1
            const isEmpty = !occupied.has(ru)
            return (
              <div
                key={`ru-${ru}`}
                className="flex items-center"
                style={{ position: 'absolute', top: `${i * RU_PX + 4}px`, left: 0, right: 0, height: `${RU_PX}px` }}
              >
                <div className="w-9 text-center text-[11px] text-gray-500 font-mono tabular-nums tracking-wider">
                  {ru}
                </div>
                <div className="flex-1">
                  {isEmpty && (
                    <div className="flex h-12 items-center justify-center text-xs text-gray-600 border-b border-white/[0.06]">
                      click drag and drop here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {/* Filled slots */}
          {sideSlots.map((s) => (
            <div
              key={s.id}
              style={{
                position: 'absolute',
                top: `${(s.ruPosition - 1) * RU_PX + 4}px`,
                left: '40px',
                right: 0,
                height: `${s.ruSize * RU_PX - 2}px`,
                zIndex: 1,
              }}
            >
              <div className="flex h-full w-full items-center gap-2 border-b border-white/[0.08] bg-transparent px-4 text-sm font-medium text-white">
                <span className="truncate">{s.label}</span>
                <span className="text-gray-600">·</span>
                <span className="text-[11px] font-normal text-gray-500 truncate">{s.deviceType}</span>
                <span className="ml-auto text-[11px] font-normal text-gray-500 font-mono tabular-nums">
                  {s.ruSize}U · RU {s.ruPosition}-{s.ruPosition + s.ruSize - 1}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

/**
 * Side picker — small dropdown next to the rack title. Same chrome as
 * the ProjectSwitcher / TabsMobileDropdown (border-2 trigger, popover
 * portal'd to body so AutoHideHeader's `overflow-hidden` can't clip
 * the menu).
 */
function SideDropdown({
  value,
  onChange,
}: {
  value: 'front' | 'rear'
  onChange: (next: 'front' | 'rear') => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !popoverRef.current?.contains(t)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    function update() {
      const btn = triggerRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  return (
    <div ref={ref} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2.5 rounded-lg border-2 bg-[#202020] px-3.5 py-2 text-sm font-medium text-white transition-colors ${
          open ? 'border-[#0178a3]' : 'border-white/10 hover:border-white/20'
        }`}
      >
        <span>{value === 'front' ? 'Front' : 'Rear'}</span>
        <svg
          className={`size-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="5 8 10 13 15 8" />
        </svg>
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="z-[1000] rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
        >
          {(['front', 'rear'] as const).map((v) => {
            const active = v === value
            return (
              <button
                key={v}
                type="button"
                onClick={() => { setOpen(false); onChange(v) }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                  active ? 'bg-[#0178a3]' : 'hover:bg-white/[0.06]'
                }`}
              >
                <span className={`text-sm font-medium ${active ? 'text-white' : 'text-gray-200'}`}>
                  {v === 'front' ? 'Front' : 'Rear'}
                </span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
