'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { FilterDropdown } from '@/components/filter-dropdown'
import { ProjectSwitcher } from '@/app/project-dashboard'
import {
  PRESETS_BY_DEPT,
  PRESET_CATEGORY_LABELS,
  PRESET_CATEGORY_ORDER,
  type PresetCategory,
  type PresetDept,
  type RackDevicePreset,
} from '@/lib/rack-presets'

/**
 * Rack studio — the page-level UI for a single RackTemplate.
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

export function RackStudio({
  project,
  userProjects,
  rack,
  slots,
  looseItems,
  canEdit,
  embedded = false,
  onCloseEmbedded,
  onDeleted,
}: {
  project: { id: number; name: string }
  /** All active projects the current user belongs to — feeds the
   *  ProjectSwitcher in the page header. Unused when `embedded`. */
  userProjects: Array<{ id: number; name: string }>
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
  /** Embedded mode: this component is rendered inside the Comms Racks
   *  tab as an inline expansion of a rack row. Skips the page header
   *  (rack name + back + project switcher) and the toolbar's tab
   *  dropdown (parent page already has one). Also drops the outer
   *  page padding so the body aligns with the row above. */
  embedded?: boolean
  /** When embedded, the host renders an explicit "Close" affordance
   *  (× button) — wire it through so the rack studio can offer the
   *  same control via the toolbar when it makes sense. Currently the
   *  host handles closing entirely, but exposing the callback keeps
   *  the option open for an in-studio close button later. */
  onCloseEmbedded?: () => void
  /** Called after the rack is successfully deleted via the settings
   *  panel's Delete button. Embedded host uses this to clear the
   *  expandedRackId state + refresh; if omitted (standalone page),
   *  the component falls back to router.push back to the Racks tab
   *  list. */
  onDeleted?: () => void
}) {
  // Silence unused-warning on onCloseEmbedded until we wire an
  // in-studio close button — kept as an explicit no-op so TS knows
  // we considered it.
  void onCloseEmbedded
  const router = useRouter()
  const [side, setSide] = useState<'front' | 'rear'>('front')
  const [pendingRu, setPendingRu] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Mobile bottom-sheet visibility — only relevant when canEdit. */
  const [sheetOpen, setSheetOpen] = useState(false)
  /** Category filter for the device library. */
  const [filter, setFilter] = useState<'all' | PresetCategory>('all')
  /** Search term — filters slot labels + deviceType. */
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  /** ID of the slot currently being edited inline. When non-null the
   *  slot's card expands to show its edit form; every row below it
   *  in the rack shifts down by EDIT_EXTRA_PX. Closes on save /
   *  cancel / delete. */
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null)
  /** Tracks whether a save / delete is in flight so the buttons can
   *  show a pending state and we don't fire concurrent requests. */
  const [editSaving, setEditSaving] = useState(false)
  /** Rack settings panel — collapses above the chassis when open.
   *  Holds the rename / relocate / resize inputs and the Delete
   *  button. Closed by default; the Settings button in the toolbar
   *  toggles it. */
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rackName, setRackName] = useState(rack.name)
  const [rackLocation, setRackLocation] = useState(rack.location ?? '')
  const [rackTotalRU, setRackTotalRU] = useState(String(rack.totalRU))
  const [rackSaving, setRackSaving] = useState(false)

  const sideSlots = slots.filter((s) => s.side === side)
  // `occupied` is built from the FULL set of slots on this side (not
  // the search-filtered subset) — search is a render-time visual
  // filter, the underlying chassis state is unchanged. That way the
  // user can't accidentally place a new device on an RU that's
  // already taken just because the slot was filtered out of view.
  const occupied = new Set<number>()
  for (const s of sideSlots) {
    for (let i = 0; i < s.ruSize; i++) occupied.add(s.ruPosition + i)
  }
  const usedRU = sideSlots.reduce((acc, s) => acc + s.ruSize, 0)
  const searchQ = search.trim().toLowerCase()
  const visibleSlots = searchQ.length === 0
    ? sideSlots
    : sideSlots.filter((s) =>
        s.label.toLowerCase().includes(searchQ) ||
        s.deviceType.toLowerCase().includes(searchQ),
      )

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
      // Loose gear — no RU position, no collision check, no pending
      // row required. Just POST to the loose endpoint and refresh.
      setAdding(true)
      setError(null)
      try {
        const res = await fetch(`/api/racks/${rack.id}/loose`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deviceType: preset.name,
            label: preset.name,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          setError((data as { error?: string } | null)?.error ?? 'Failed to add loose item')
          setAdding(false)
          return
        }
        // Loose items don't consume a pending RU — keep pendingRu as
        // is so the operator can still place a rack-mounted device
        // afterward without re-tapping the row.
        setSheetOpen(false)
        setAdding(false)
        router.refresh()
      } catch {
        setError('Network error')
        setAdding(false)
      }
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

  async function handleLooseDelete(looseId: number, label: string) {
    if (!canEdit) return
    if (!window.confirm(`Remove "${label}" from the loose-gear tray?`)) return
    setError(null)
    try {
      const res = await fetch(`/api/racks/${rack.id}/loose/${looseId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError((data as { error?: string } | null)?.error ?? 'Failed to remove')
        return
      }
      router.refresh()
    } catch {
      setError('Network error')
    }
  }

  async function handleRackSave() {
    if (!canEdit) return
    setError(null)
    const name = rackName.trim()
    if (!name) { setError('Rack name is required'); return }
    const totalRU = parseInt(rackTotalRU, 10)
    if (!Number.isFinite(totalRU) || totalRU < 1 || totalRU > 60) {
      setError('RU height must be 1–60'); return
    }
    setRackSaving(true)
    try {
      const res = await fetch(`/api/racks/${rack.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          location: rackLocation.trim() || null,
          totalRU,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError((data as { error?: string } | null)?.error ?? 'Failed to save')
        setRackSaving(false)
        return
      }
      setRackSaving(false)
      setSettingsOpen(false)
      router.refresh()
    } catch {
      setError('Network error')
      setRackSaving(false)
    }
  }

  async function handleRackDelete() {
    if (!canEdit) return
    if (!window.confirm(`Delete rack "${rack.name}"? Every slot and loose item attached to it goes with it. This can't be undone.`)) return
    setError(null)
    setRackSaving(true)
    try {
      const res = await fetch(`/api/racks/${rack.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError((data as { error?: string } | null)?.error ?? 'Failed to delete rack')
        setRackSaving(false)
        return
      }
      setRackSaving(false)
      if (onDeleted) {
        // Embedded host (e.g. the Comms Racks tab) owns the cleanup —
        // clearing the expanded-row state + refreshing the rack list.
        onDeleted()
      } else {
        // Standalone page — bounce back to the Racks tab list so the
        // user isn't stranded on a 404'd deep link.
        router.push(`/projects/${project.id}?tab=racks`)
      }
    } catch {
      setError('Network error')
      setRackSaving(false)
    }
  }

  return (
    <div className={
      embedded
        ? 'flex w-full flex-col'
        : 'mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-4 sm:px-6 lg:px-8 py-5 pb-28 sm:pb-8'
    }>

      {/* ─── Page header ───
          Rack name + meta on the left, Back button + ProjectSwitcher
          on the right. Mirrors the Comms page header so the rack
          designer reads as a logical continuation of /projects/[id]?
          tab=racks (same shell, deeper view). Hidden in embedded
          mode — the host row provides the name + close affordance. */}
      {!embedded && (
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
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Back to the Comms Racks tab. Just a chevron-left icon
              now — operators recognise it as Back and we save a chunk
              of horizontal real estate on mobile where the project
              switcher is competing for the same row. */}
          <button
            type="button"
            onClick={() => router.push(`/projects/${project.id}?tab=racks`)}
            aria-label="Back to Racks"
            className="flex size-9 items-center justify-center rounded-lg border border-white/10 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
          >
            <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          {/* ProjectSwitcher — switching projects sends the user to
              /projects/<newId>?tab=racks (back to the Racks tab list
              for that show — we can't deep-link to an equivalent rack
              there). Mobile: half-row width like everywhere else. */}
          <div className="w-[calc(50vw-1rem)] sm:w-auto">
            <ProjectSwitcher
              projectId={project.id}
              projectName={project.name}
              userProjects={userProjects}
              basePath="/projects/:id"
            />
          </div>
        </div>
      </header>
      )}

      {/* ─── Toolbar ───
          Left cluster: rack-context controls (side picker).
          Right cluster: tab dropdown (jumps back to a sibling tab on
            the parent project) + per-tab search (filters slot labels +
            device types).
          Same pattern as the Comms / Radios single-row toolbar so the
          chrome reads consistently. */}
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
        {/* Tab dropdown — only when the rack studio is a full page.
            In embedded mode the parent Comms page already owns the
            tab dropdown above, so we'd be doubling it up. */}
        {!embedded && !searchOpen && (
          <div className="w-[280px]">
            <FilterDropdown
              ariaLabel="Project tab"
              value="racks"
              onChange={(v) => {
                if (v === 'racks') return
                // Other tabs live on the Comms page — bounce the user
                // back to the project at that tab.
                router.push(`/projects/${project.id}?tab=${v}`)
              }}
              widthClass="w-full"
              options={[
                { value: 'equipment', label: 'Equipment' },
                { value: 'team', label: 'Team' },
                { value: 'picklist', label: 'Pick List' },
                { value: 'stage-plots', label: 'Plots' },
                { value: 'racks', label: 'Racks' },
              ]}
            />
          </div>
        )}
        {/* Rack settings — toggles the inline rename / location /
            RU-height / Delete panel below the toolbar. Admin/manager
            only; hidden on read-only views. Stays compact (square
            button matching the search toggle) so the toolbar density
            doesn't change. */}
        {canEdit && !searchOpen && (
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="Rack settings"
            aria-pressed={settingsOpen}
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              settingsOpen
                ? 'border-[#0178a3] bg-[#0178a3] text-white'
                : 'border-white/10 bg-[#2a2a2a] text-gray-200 hover:border-white/20 hover:bg-[#313131] hover:text-white'
            }`}
          >
            <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </button>
        )}
        {/* Search — collapsible toggle just like Comms / Radios.
            When open, the input takes the same space the tab
            dropdown was occupying. */}
        {searchOpen ? (
          <div className="flex items-center gap-2 flex-1 sm:flex-initial">
            <input
              type="text"
              autoFocus
              placeholder="Search devices…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-[220px] rounded-lg border-2 border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
            />
            <button
              type="button"
              onClick={() => { setSearchOpen(false); setSearch('') }}
              aria-label="Close search"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
            >
              <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
          >
            <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.343-4.343m0 0A8 8 0 1 0 5.343 5.343a8 8 0 0 0 11.314 11.314Z" />
            </svg>
          </button>
        )}
      </div>

      {/* ─── Rack settings panel ───
          Collapses above the chassis when the Settings cog is tapped.
          Name + Location + RU height fields plus Save / Cancel and a
          destructive Delete on the right. Shares the same blue-tint
          card treatment as the slot edit form for visual consistency. */}
      {settingsOpen && canEdit && (
        <div className="mb-3 rounded-lg border border-[#22a7d3]/40 bg-[#0178a3]/[0.04] p-4">
          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Rack settings</div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_120px] gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Name</div>
              <input
                value={rackName}
                onChange={(e) => setRackName(e.target.value)}
                disabled={rackSaving}
                placeholder="FOH Rack"
                className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
              />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Location <span className="normal-case text-gray-600">(optional)</span></div>
              <input
                value={rackLocation}
                onChange={(e) => setRackLocation(e.target.value)}
                disabled={rackSaving}
                placeholder="FOH / MON / Studio A"
                className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
              />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">RU height</div>
              <input
                type="number"
                min={1}
                max={60}
                value={rackTotalRU}
                onChange={(e) => setRackTotalRU(e.target.value)}
                disabled={rackSaving}
                className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
              />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleRackDelete}
              disabled={rackSaving}
              className="rounded-lg border border-red-500/40 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/[0.08] hover:border-red-500/60 disabled:opacity-50"
            >
              Delete rack
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  // Reset fields to their server values and collapse — same
                  // semantics as the slot edit's Cancel.
                  setRackName(rack.name)
                  setRackLocation(rack.location ?? '')
                  setRackTotalRU(String(rack.totalRU))
                  setSettingsOpen(false)
                }}
                disabled={rackSaving}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRackSave}
                disabled={rackSaving}
                className="rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rackSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Stats line ───
          Embedded mode drops the rack name (the host row above shows
          it) but keeps the side + utilization counts since they
          change as the user toggles Front/Rear. */}
      <div className="text-xs text-gray-500 mb-3">
        {!embedded && (
          <>
            <span className="text-gray-300">{rack.name}</span>
            <span className="mx-1 text-gray-600">·</span>
            <span>{rack.totalRU}RU</span>
            <span className="mx-1 text-gray-600">·</span>
          </>
        )}
        <span>{side === 'front' ? 'Front view' : 'Rear view'}</span>
        <span className="mx-1 text-gray-600">·</span>
        <span>{usedRU} of {rack.totalRU} RUs used</span>
      </div>

      {/* Error toast (inline above rack) — dismissible via the × so
          the user can clear stale guidance like "Tap an empty RU row
          first" once they've taken the action. */}
      {error && (
        <div className="mb-3 flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="shrink-0 text-red-300/70 hover:text-red-100 transition-colors leading-none -mt-0.5"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ─── Loose gear tray ───
          Shown whenever the user can edit (so they have somewhere to
          drop loose presets), OR when there are existing items even
          if the viewer is read-only. The chips are clickable to
          remove when canEdit — × icon on the right side of each. */}
      {(looseItems.length > 0 || canEdit) && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Loose gear · no RU</div>
            <div className="text-[10px] text-gray-600">velcro / drawer</div>
          </div>
          {looseItems.length === 0 ? (
            <div className="text-[11px] text-gray-600 italic">
              Tap a loose-gear device in the library to add it here.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {looseItems.map((g) => (
                <div
                  key={g.id}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#2a2a2a] border border-white/10 text-xs text-gray-200"
                >
                  <span>{g.label || g.deviceType}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleLooseDelete(g.id, g.label || g.deviceType)}
                      aria-label={`Remove ${g.label || g.deviceType}`}
                      className="-mr-1 flex size-4 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-red-400"
                    >
                      <svg className="size-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Main grid: rack on left, library on right (desktop only) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 lg:items-stretch lg:min-h-0">

        {/* Rack visualization. When a slot is being edited, every row
            BELOW its last occupied RU gets shifted down by
            EDIT_EXTRA_PX so the inline edit form has room. The
            container itself grows by the same amount so the bordered
            chassis still encloses everything. */}
        {(() => {
          const editingSlot = editingSlotId ? sideSlots.find((s) => s.id === editingSlotId) ?? null : null
          const editingEndRu = editingSlot ? editingSlot.ruPosition + editingSlot.ruSize - 1 : 0
          const EDIT_EXTRA_PX = 320
          const offsetFor = (ru: number) => editingSlot && ru > editingEndRu ? EDIT_EXTRA_PX : 0
          const containerHeight = rack.totalRU * RU_PX + 8 + (editingSlot ? EDIT_EXTRA_PX : 0)
          return (
            <div className={`relative p-2 overflow-y-auto ${embedded ? 'max-h-[70vh]' : 'max-h-[calc(100vh-320px)]'}`}>
              <div className="relative" style={{ height: `${containerHeight}px`, transition: 'height 180ms ease-out' }}>
                {/* Empty rows + RU numbers */}
                {Array.from({ length: rack.totalRU }, (_, i) => {
                  const ru = i + 1
                  const isEmpty = !occupied.has(ru)
                  const isPending = pendingRu === ru
                  return (
                    <div
                      key={`ru-${ru}`}
                      className="flex items-center"
                      style={{
                        position: 'absolute',
                        top: `${i * RU_PX + 4 + offsetFor(ru)}px`,
                        left: 0,
                        right: 0,
                        height: `${RU_PX}px`,
                        transition: 'top 180ms ease-out',
                      }}
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
                            className={`flex h-[46px] w-full items-center justify-center text-xs transition-colors disabled:cursor-default ${
                              isPending
                                ? 'rounded-lg border border-[#0178a3]/60 bg-[#0178a3]/15 text-[#22a7d3]'
                                : 'border-b border-white/[0.06] text-gray-600 hover:border-b-[#0178a3]/40 hover:text-[#22a7d3] hover:bg-[#0178a3]/[0.04]'
                            } ${canEdit ? 'cursor-pointer' : ''}`}
                          >
                            {isPending ? 'pick a device →' : '+ Drop Here'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                {/* Filled slots (search-filtered for display only). */}
                {visibleSlots.map((s) => {
                  const isEditing = s.id === editingSlotId
                  return (
                    <SlotRow
                      key={s.id}
                      slot={s}
                      isEditing={isEditing}
                      canEdit={canEdit}
                      topPx={(s.ruPosition - 1) * RU_PX + 4 + offsetFor(s.ruPosition)}
                      heightPx={isEditing ? s.ruSize * RU_PX - 2 + EDIT_EXTRA_PX : s.ruSize * RU_PX - 2}
                      onOpenEdit={() => setEditingSlotId(s.id)}
                      onClose={() => setEditingSlotId(null)}
                      rackId={rack.id}
                      totalRU={rack.totalRU}
                      presets={presets}
                      editSaving={editSaving}
                      setEditSaving={setEditSaving}
                      setError={setError}
                      refreshAfter={() => { setEditingSlotId(null); router.refresh() }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Device library aside (desktop only) */}
        <aside className={`hidden lg:flex lg:flex-col ${embedded ? 'lg:max-h-[70vh]' : 'lg:max-h-[calc(100vh-320px)]'}`}>
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
                    disabled={!canEdit || adding}
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

/* ════════════════════════════════════════════════════════════════════
 * SlotRow
 * Renders a single RackSlot — display mode when read-only OR not
 * currently being edited, expanded inline edit form when editing.
 * Form fields: device type (preset picker), label, RU position+size,
 * optional equipment link. Actions: Save / Cancel / Delete.
 * ════════════════════════════════════════════════════════════════════ */

function SlotRow({
  slot,
  isEditing,
  canEdit,
  topPx,
  heightPx,
  onOpenEdit,
  onClose,
  rackId,
  totalRU,
  presets,
  editSaving,
  setEditSaving,
  setError,
  refreshAfter,
}: {
  slot: Slot
  isEditing: boolean
  canEdit: boolean
  topPx: number
  heightPx: number
  onOpenEdit: () => void
  onClose: () => void
  rackId: number
  totalRU: number
  presets: readonly RackDevicePreset[]
  editSaving: boolean
  setEditSaving: (v: boolean) => void
  setError: (msg: string | null) => void
  refreshAfter: () => void
}) {
  // Local form state — only relevant while editing. Initialized from
  // the slot's current values; mutated on input; sent to the API on
  // Save.
  const [deviceType, setDeviceType] = useState(slot.deviceType)
  const [label, setLabel] = useState(slot.label)
  const [ruPosition, setRuPosition] = useState(String(slot.ruPosition))
  const [ruSize, setRuSize] = useState(String(slot.ruSize))

  async function handleSave() {
    setError(null)
    const ruP = parseInt(ruPosition, 10)
    const ruS = parseInt(ruSize, 10)
    if (!Number.isFinite(ruP) || ruP < 1) { setError('Start RU must be a positive integer'); return }
    if (!Number.isFinite(ruS) || ruS < 1) { setError('RU size must be a positive integer'); return }
    if (ruP + ruS - 1 > totalRU) { setError(`Slot would exceed rack height (${totalRU}RU)`); return }
    setEditSaving(true)
    try {
      const res = await fetch(`/api/racks/${rackId}/slots/${slot.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deviceType,
          label: label.trim() || deviceType,
          ruPosition: ruP,
          ruSize: ruS,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError((data as { error?: string } | null)?.error ?? 'Failed to save')
        setEditSaving(false)
        return
      }
      setEditSaving(false)
      refreshAfter()
    } catch {
      setError('Network error')
      setEditSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${slot.label}"?`)) return
    setError(null)
    setEditSaving(true)
    try {
      const res = await fetch(`/api/racks/${rackId}/slots/${slot.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError((data as { error?: string } | null)?.error ?? 'Failed to delete')
        setEditSaving(false)
        return
      }
      setEditSaving(false)
      refreshAfter()
    } catch {
      setError('Network error')
      setEditSaving(false)
    }
  }

  const ruSpan = `${slot.ruSize}U · RU ${slot.ruPosition}-${slot.ruPosition + slot.ruSize - 1}`

  return (
    <div
      style={{
        position: 'absolute',
        top: `${topPx}px`,
        left: '40px',
        right: 0,
        height: `${heightPx}px`,
        zIndex: isEditing ? 10 : 1,
        transition: 'top 180ms ease-out, height 180ms ease-out',
      }}
    >
      {isEditing ? (
        <div className="flex h-full w-full flex-col rounded-lg border border-[#22a7d3]/40 bg-[#0178a3]/[0.04] overflow-hidden">
          {/* Header row — mirrors the read-only row layout so the
              card reads continuous when expanded. */}
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/[0.08] px-4 text-sm font-medium text-white"
               style={{ height: '48px' }}>
            <span className="truncate">{slot.label}</span>
            <span className="text-gray-600">·</span>
            <span className="text-[11px] font-normal text-gray-500 truncate">{slot.deviceType}</span>
            <span className="ml-auto text-[11px] font-normal text-gray-500 font-mono tabular-nums">{ruSpan}</span>
          </div>
          {/* Form body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Device type</div>
              <select
                value={deviceType}
                onChange={(e) => setDeviceType(e.target.value)}
                disabled={editSaving}
                className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
              >
                {/* Include the slot's current value even if it's not in
                    the preset list (e.g. a custom device added later
                    that's been deleted). */}
                {!presets.some((p) => p.name === deviceType) && (
                  <option value={deviceType}>{deviceType} (custom)</option>
                )}
                {presets.filter((p) => p.ruSize > 0).map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} · {p.ruSize}U
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Label</div>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={editSaving}
                placeholder={deviceType}
                className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Start RU</div>
                <input
                  type="number"
                  min={1}
                  max={totalRU}
                  value={ruPosition}
                  onChange={(e) => setRuPosition(e.target.value)}
                  disabled={editSaving}
                  className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
                />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">RU size</div>
                <input
                  type="number"
                  min={1}
                  max={totalRU}
                  value={ruSize}
                  onChange={(e) => setRuSize(e.target.value)}
                  disabled={editSaving}
                  className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
                />
              </div>
            </div>
            {/* Action row */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={editSaving}
                className="rounded-lg border border-red-500/40 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/[0.08] hover:border-red-500/60 disabled:opacity-50"
              >
                Delete
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={editSaving}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={editSaving}
                  className="rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {editSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        // Each slot is its own bordered card now — the chassis no
        // longer carries an outer border, units do.
        <div className="flex h-full w-full items-center gap-2 rounded-lg border border-white/15 bg-transparent px-4 text-sm font-medium text-white">
          <span className="truncate">{slot.label}</span>
          <span className="text-gray-600">·</span>
          <span className="text-[11px] font-normal text-gray-500 truncate">{slot.deviceType}</span>
          <span className="ml-2 text-[11px] font-normal text-gray-500 font-mono tabular-nums">{ruSpan}</span>
          {canEdit && (
            <button
              type="button"
              onClick={onOpenEdit}
              className="ml-auto shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
            >
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  )
}

