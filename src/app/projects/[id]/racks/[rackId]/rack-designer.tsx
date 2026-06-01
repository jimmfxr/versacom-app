'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { FilterDropdown } from '@/components/filter-dropdown'
import {
  PRESETS_BY_DEPT,
  PRESET_CATEGORY_LABELS,
  PRESET_CATEGORY_ORDER,
  type PresetCategory,
  type PresetDept,
  type RackDevicePreset,
} from '@/lib/rack-presets'

/**
 * Rack designer — the page-level UI for a single RackTemplate.
 *
 * v1 (previous commit) was read-only: bordered chassis, RU column,
 * empty rows with placeholder text, side toggle.
 *
 * v2 (this commit) adds the device library aside and a single-click
 * add flow:
 *   1. Click an empty RU row → that RU becomes the "pending target"
 *      (row highlights cyan, on mobile the bottom-sheet library opens).
 *   2. Click a device in the library → POST creates a RackSlot at the
 *      pending RU, page re-fetches via router.refresh(), pending
 *      clears.
 *   3. Click the highlighted row again to cancel without picking.
 *
 * Loose-gear devices (ruSize=0) are shown in the library but disabled
 * for now — they get wired up in a follow-up alongside the loose-gear
 * tray's add flow.
 *
 * Drag-and-drop comes in the next commit.
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

const RU_PX = 48

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
  const [pendingRu, setPendingRu] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Mobile bottom-sheet visibility — only relevant when canEdit. */
  const [sheetOpen, setSheetOpen] = useState(false)
  /** Category filter for the device library. */
  const [filter, setFilter] = useState<'all' | PresetCategory>('all')

  const sideSlots = slots.filter((s) => s.side === side)
  const occupied = new Set<number>()
  for (const s of sideSlots) {
    for (let i = 0; i < s.ruSize; i++) occupied.add(s.ruPosition + i)
  }
  const usedRU = sideSlots.reduce((acc, s) => acc + s.ruSize, 0)

  const dept: PresetDept = rack.dept === 'radios' ? 'radios' : 'comms'
  const presets = PRESETS_BY_DEPT[dept]

  function handleEmptyRowClick(ru: number) {
    if (!canEdit) return
    if (pendingRu === ru) {
      // Tap-the-same-row toggles off (cancel without picking).
      setPendingRu(null)
      setSheetOpen(false)
      return
    }
    setPendingRu(ru)
    setError(null)
    // Mobile: open the sheet so the user can pick.
    setSheetOpen(true)
  }

  async function handleDevicePick(preset: RackDevicePreset) {
    if (!canEdit) return
    if (preset.ruSize === 0) {
      // Loose gear — placeholder for now. The loose-gear tray's add
      // flow lands in a follow-up commit; for v2 we just no-op so the
      // operator gets feedback this isn't wired yet.
      setError('Loose gear drop coming in the next commit.')
      return
    }
    const ru = pendingRu
    if (ru == null) {
      setError('Tap an empty RU row first, then pick a device.')
      return
    }
    if (ru + preset.ruSize - 1 > rack.totalRU) {
      setError(`${preset.name} (${preset.ruSize}U) doesn't fit at RU ${ru}.`)
      return
    }
    // Local collision check so we surface the message immediately
    // instead of waiting for a 409.
    for (let i = 0; i < preset.ruSize; i++) {
      if (occupied.has(ru + i)) {
        setError(`RU ${ru + i} is already taken — pick another row.`)
        return
      }
    }
    setAdding(true)
    setError(null)
    try {
      const res = await fetch(`/api/racks/${rack.id}/slots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ruPosition: ru,
          ruSize: preset.ruSize,
          side,
          deviceType: preset.name,
          label: preset.name,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError((data as { error?: string } | null)?.error ?? 'Failed to add device')
        setAdding(false)
        return
      }
      // Success — clear pending state and refresh page data so the
      // new slot renders.
      setPendingRu(null)
      setSheetOpen(false)
      setAdding(false)
      router.refresh()
    } catch {
      setError('Network error')
      setAdding(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-4 sm:px-6 lg:px-8 py-5 pb-28 sm:pb-8">

      {/* ─── Page header ─── */}
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

      {/* ─── Toolbar: side picker (left) ───
          Uses the shared FilterDropdown component (same one Radios
          uses for Sort / Filter chips) so the dropdown chrome reads
          consistently across the app. */}
      <div className="flex items-center gap-3 flex-wrap py-4">
        <FilterDropdown
          ariaLabel="Rack side"
          value={side}
          onChange={(v) => { setSide(v as 'front' | 'rear'); setPendingRu(null) }}
          widthClass="w-32 shrink-0"
          options={[
            { value: 'front', label: 'Front' },
            { value: 'rear', label: 'Rear' },
          ]}
        />
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

      {/* Error toast (inline above rack) */}
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ─── Loose gear tray ─── */}
      {looseItems.length > 0 && (
        <div className="mb-3">
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

      {/* ─── Main grid: rack on left, library on right (desktop only) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 lg:items-stretch lg:min-h-0">

        {/* Rack visualization */}
        <div className="relative rounded-lg border border-white/15 p-2 overflow-y-auto max-h-[calc(100vh-320px)]">
          <div className="relative" style={{ height: `${rack.totalRU * RU_PX + 8}px` }}>
            {/* Empty rows + RU numbers — full grid first, slots layer on top */}
            {Array.from({ length: rack.totalRU }, (_, i) => {
              const ru = i + 1
              const isEmpty = !occupied.has(ru)
              const isPending = pendingRu === ru
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
                      <button
                        type="button"
                        onClick={() => handleEmptyRowClick(ru)}
                        disabled={!canEdit}
                        className={`flex h-12 w-full items-center justify-center text-xs border-b transition-colors disabled:cursor-default ${
                          isPending
                            ? 'bg-[#0178a3]/15 border-b-[#0178a3]/60 text-[#22a7d3]'
                            : 'text-gray-600 border-b-white/[0.06] hover:border-b-[#0178a3]/40 hover:text-[#22a7d3] hover:bg-[#0178a3]/[0.04]'
                        } ${canEdit ? 'cursor-pointer' : ''}`}
                      >
                        {isPending ? 'pick a device →' : 'click drag and drop here'}
                      </button>
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

        {/* Device library aside (desktop only) */}
        <aside className="hidden lg:flex lg:flex-col lg:max-h-[calc(100vh-320px)]">
          <DeviceLibrary
            presets={presets}
            filter={filter}
            onFilterChange={setFilter}
            onPick={handleDevicePick}
            pendingRu={pendingRu}
            adding={adding}
            canEdit={canEdit}
            renderInSheet={false}
          />
        </aside>

      </div>

      {/* Mobile bottom-sheet — opens when user taps an empty RU row */}
      {sheetOpen && (
        <DeviceLibrarySheet
          onClose={() => { setSheetOpen(false); setPendingRu(null) }}
          presets={presets}
          filter={filter}
          onFilterChange={setFilter}
          onPick={handleDevicePick}
          pendingRu={pendingRu}
          adding={adding}
          canEdit={canEdit}
        />
      )}

    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
 * Device library list
 * ════════════════════════════════════════════════════════════════════ */

function DeviceLibrary({
  presets,
  filter,
  onFilterChange,
  onPick,
  pendingRu,
  adding,
  canEdit,
  renderInSheet,
}: {
  presets: readonly RackDevicePreset[]
  filter: 'all' | PresetCategory
  onFilterChange: (next: 'all' | PresetCategory) => void
  onPick: (preset: RackDevicePreset) => void
  pendingRu: number | null
  adding: boolean
  canEdit: boolean
  renderInSheet: boolean
}) {
  const filtered = filter === 'all' ? presets : presets.filter((p) => p.category === filter)
  const showHeaders = filter === 'all'

  return (
    <>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 flex-shrink-0">
        Device library
      </div>
      {/* + Custom device — placeholder for now. The CRUD lands in a
          later commit. */}
      <button
        type="button"
        disabled
        className="w-full mb-2 flex-shrink-0 rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 opacity-40 cursor-not-allowed"
      >
        + Custom device
      </button>
      {/* Category filter — shared FilterDropdown component. */}
      <div className="flex-shrink-0 mb-3">
        <FilterDropdown
          ariaLabel="Device category"
          value={filter}
          onChange={(v) => onFilterChange(v as 'all' | PresetCategory)}
          widthClass="w-full"
          options={[
            { value: 'all', label: 'All devices' },
            ...PRESET_CATEGORY_ORDER.map((c) => ({ value: c, label: PRESET_CATEGORY_LABELS[c] })),
          ]}
        />
      </div>
      <div
        className={`${renderInSheet ? '' : 'flex-1 min-h-0 overflow-y-auto pr-1'} space-y-3`}
        style={renderInSheet ? undefined : undefined}
      >
        {showHeaders ? (
          PRESET_CATEGORY_ORDER.map((cat) => {
            const items = presets.filter((p) => p.category === cat)
            if (items.length === 0) return null
            return (
              <Section key={cat} label={PRESET_CATEGORY_LABELS[cat]}>
                {items.map((p) => (
                  <DeviceTile
                    key={p.name}
                    preset={p}
                    onClick={() => onPick(p)}
                    disabled={!canEdit || adding || (p.ruSize === 0 && true)}
                    highlightTarget={pendingRu != null && p.ruSize > 0}
                  />
                ))}
              </Section>
            )
          })
        ) : (
          <Section label={PRESET_CATEGORY_LABELS[filter as PresetCategory]} hideLabel>
            {filtered.map((p) => (
              <DeviceTile
                key={p.name}
                preset={p}
                onClick={() => onPick(p)}
                disabled={!canEdit || adding || (p.ruSize === 0 && true)}
                highlightTarget={pendingRu != null && p.ruSize > 0}
              />
            ))}
          </Section>
        )}
      </div>
    </>
  )
}

function Section({
  label,
  hideLabel,
  children,
}: {
  label: string
  hideLabel?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      {!hideLabel && (
        <div className="text-[10px] uppercase tracking-wider text-gray-600 font-semibold mb-1.5 px-1">
          {label}
        </div>
      )}
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function DeviceTile({
  preset,
  onClick,
  disabled,
  highlightTarget,
}: {
  preset: RackDevicePreset
  onClick: () => void
  disabled: boolean
  highlightTarget: boolean
}) {
  const isLoose = preset.ruSize === 0
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
        disabled
          ? 'border-white/10 text-gray-500 cursor-not-allowed opacity-50'
          : highlightTarget
            ? 'border-[#22a7d3]/50 text-gray-200 hover:bg-[#0178a3]/10'
            : 'border-white/15 text-gray-300 hover:border-white/25 hover:bg-white/[0.03]'
      }`}
    >
      <span className="truncate">{preset.name}</span>
      <span className="ml-auto shrink-0 text-[10px] text-gray-500">
        {isLoose ? '—' : `${preset.ruSize}U`}
      </span>
    </button>
  )
}

/* ════════════════════════════════════════════════════════════════════
 * Mobile bottom sheet
 * ════════════════════════════════════════════════════════════════════ */

function DeviceLibrarySheet({
  onClose,
  presets,
  filter,
  onFilterChange,
  onPick,
  pendingRu,
  adding,
  canEdit,
}: {
  onClose: () => void
  presets: readonly RackDevicePreset[]
  filter: 'all' | PresetCategory
  onFilterChange: (next: 'all' | PresetCategory) => void
  onPick: (preset: RackDevicePreset) => void
  pendingRu: number | null
  adding: boolean
  canEdit: boolean
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[80] lg:hidden">
      {/* Backdrop tap closes the sheet. */}
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 max-h-[60vh] bg-[#1a1a1a] border-t border-white/10 rounded-t-2xl shadow-2xl flex flex-col"
      >
        {/* Drag-handle bar */}
        <div className="flex justify-center pt-2 pb-1 cursor-pointer" onClick={onClose}>
          <div className="w-9 h-1 rounded-full bg-white/20" />
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <div className="text-sm font-semibold text-white">
            {pendingRu != null ? `Pick a device for RU ${pendingRu}` : 'Device library'}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-2xl leading-none">
            ×
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6">
          <DeviceLibrary
            presets={presets}
            filter={filter}
            onFilterChange={onFilterChange}
            onPick={onPick}
            pendingRu={pendingRu}
            adding={adding}
            canEdit={canEdit}
            renderInSheet
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}

