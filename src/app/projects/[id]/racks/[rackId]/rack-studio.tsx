'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { FilterDropdown } from '@/components/filter-dropdown'
import { Modal } from '@/components/modal'
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

/** A device shown in the library list — either a hard-coded preset
 *  or a user-added custom. Customs carry their RackDevice row id
 *  + an isCustom flag so the chip can offer a × delete affordance. */
type LibraryItem = RackDevicePreset & { id?: number; isCustom?: boolean }

const RU_PX = 48

export function RackStudio({
  project,
  userProjects,
  rack,
  slots,
  looseItems,
  customDevices = [],
  canEdit,
  embedded = false,
  onCloseEmbedded,
  onDeleted,
  side: sideProp,
  onSideChange,
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
  /** Project-scoped custom devices. Merged with the hard-coded
   *  presets so the library renders them inline in the appropriate
   *  category section. Empty by default for projects that haven't
   *  added any. */
  customDevices?: Array<{ id: number; name: string; ruSize: number; category: string }>
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
  /** Controlled side state. When both `side` and `onSideChange` are
   *  provided the parent owns the front/rear toggle — used in
   *  embedded mode so the desktop side picker can sit in the parent
   *  page's tab+search toolbar row instead of the rack studio's
   *  inner toolbar. Mobile still renders the inner picker since the
   *  parent's row is `sm:flex` only. Leave both undefined to fall
   *  back to local state (standalone page). */
  side?: 'front' | 'rear'
  onSideChange?: (next: 'front' | 'rear') => void
}) {
  // Silence unused-warning on onCloseEmbedded until we wire an
  // in-studio close button — kept as an explicit no-op so TS knows
  // we considered it.
  void onCloseEmbedded
  const router = useRouter()
  // Controlled-or-uncontrolled side state. When the parent supplies
  // `side`/`onSideChange` (embedded mode), we use those so the parent
  // can render a duplicate Front/Rear control in its own toolbar
  // and stay in lockstep. Otherwise local state — same UX as before.
  const [internalSide, setInternalSide] = useState<'front' | 'rear'>('front')
  const side = sideProp ?? internalSide
  const setSide = onSideChange ?? setInternalSide
  const [pendingRu, setPendingRu] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Mobile bottom-sheet visibility — only relevant when canEdit. */
  const [sheetOpen, setSheetOpen] = useState(false)
  /** Category filter for the device library. */
  const [filter, setFilter] = useState<'all' | PresetCategory>('all')
  /** Device library search term — filters preset items by name.
   *  Previously this was a toolbar-level slot-label filter; moved
   *  into the library aside since searching the library is the
   *  more useful action (chassis is small, library has many items). */
  const [librarySearch, setLibrarySearch] = useState('')
  /** + Custom device form visibility. Opens inline at the top of the
   *  library when the user taps + Custom. Lives at this level so
   *  both the desktop aside and the mobile sheet share the
   *  open/close state. */
  const [customFormOpen, setCustomFormOpen] = useState(false)
  /** Custom device delete in-flight tracker — keyed by device id so
   *  we can disable the × on one chip without freezing the others. */
  const [customDeletingId, setCustomDeletingId] = useState<number | null>(null)
  /** Drag-and-drop state — when set, the user is mid-drag from a
   *  library tile. The ghost element tracks the cursor, and the
   *  chassis highlights the RU rows the device would occupy on
   *  release. Click-to-add still works as a fallback for users who
   *  prefer the original two-tap flow. */
  const [dragPreset, setDragPreset] = useState<RackDevicePreset | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [dragHoverRu, setDragHoverRu] = useState<number | null>(null)
  // Ref so the pointer handlers see the latest preset / hover without
  // re-binding on every state change.
  const dragStateRef = useRef<{ preset: RackDevicePreset | null; hoverRu: number | null }>({ preset: null, hoverRu: null })
  /** Unified in-app confirm modal. Replaces window.confirm() for all
   *  destructive rack-related actions (slot delete, loose-gear ×,
   *  custom-device ×) so the operator sees a styled prompt
   *  consistent with the rest of the app instead of the browser's
   *  native dialog. Caller stuffs the message + onConfirm callback
   *  in via confirmDelete(); the Modal at the end of the JSX
   *  renders the prompt. */
  const [deleteConfirm, setDeleteConfirm] = useState<{
    title: string
    message: React.ReactNode
    confirmLabel?: string
    onConfirm: () => void | Promise<void>
  } | null>(null)
  const [confirmRunning, setConfirmRunning] = useState(false)
  function confirmDelete(opts: {
    title: string
    message: React.ReactNode
    confirmLabel?: string
    onConfirm: () => void | Promise<void>
  }) {
    setDeleteConfirm(opts)
  }
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
  // Chassis renders every slot on this side — no filter pass. The
  // search affordance moved into the device library aside.
  const visibleSlots = sideSlots

  const dept: PresetDept = rack.dept === 'radios' ? 'radios' : 'comms'
  const presets = PRESETS_BY_DEPT[dept]
  // Merge presets + custom devices into a single library list. Each
  // entry carries the same shape so the filter / search / render
  // pipeline is identical for both kinds; custom entries gain an
  // optional `id` + `isCustom` flag so the library row can show a ×
  // delete affordance only on the user-added ones.
  const libraryItems: LibraryItem[] = [
    ...presets.map((p) => ({ ...p })),
    ...customDevices.map((d) => ({
      // PresetCategory string-matches the RackDevice.category column;
      // anything outside the union falls back to 'devices' so a
      // future schema drift doesn't break the render.
      name: d.name,
      ruSize: d.ruSize,
      category: (['devices', 'switches', 'audio', 'drawers', 'power', 'loose'] as const).includes(d.category as PresetCategory)
        ? (d.category as PresetCategory)
        : ('devices' as PresetCategory),
      id: d.id,
      isCustom: true as const,
    })),
  ]

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

  /** Initiates a drag from a library tile. Called from DeviceTile's
   *  onPointerDown. Captures the pointer on document so the gesture
   *  survives leaving the tile, even if the cursor crosses the
   *  library's overflow boundary. */
  function startLibraryDrag(preset: RackDevicePreset, e: React.PointerEvent) {
    if (!canEdit) return
    if (preset.ruSize === 0) {
      // Loose gear has no RU position — keep the click-to-add flow
      // for it (drop targets only make sense for RU-occupying gear).
      return
    }
    setDragPreset(preset)
    setDragPos({ x: e.clientX, y: e.clientY })
    setDragHoverRu(null)
    dragStateRef.current = { preset, hoverRu: null }
  }

  // Global pointer handlers for the library-drag gesture. Effects
  // attach a single listener pair while dragPreset is set; on
  // pointerup they fire the same handleDevicePick we use for clicks.
  useEffect(() => {
    if (!dragPreset) return
    function findHoverRu(x: number, y: number): number | null {
      // elementsFromPoint covers nested overflow scrollers + portals
      // that elementFromPoint can miss. Walk the stack looking for
      // any node with data-rack-ru.
      const els = typeof document !== 'undefined' ? document.elementsFromPoint(x, y) : []
      for (const el of els) {
        const ru = (el as HTMLElement).dataset?.rackRu
        if (ru != null) return parseInt(ru, 10)
      }
      return null
    }
    function handleMove(ev: PointerEvent) {
      setDragPos({ x: ev.clientX, y: ev.clientY })
      const ru = findHoverRu(ev.clientX, ev.clientY)
      setDragHoverRu(ru)
      dragStateRef.current.hoverRu = ru
    }
    function handleUp() {
      const { preset, hoverRu } = dragStateRef.current
      setDragPreset(null)
      setDragPos(null)
      setDragHoverRu(null)
      dragStateRef.current = { preset: null, hoverRu: null }
      if (!preset || hoverRu == null) return
      // Stage the pending target as the drop RU, then hand off to
      // the existing handleDevicePick — same validation, same POST,
      // same router.refresh, same error surface.
      setPendingRu(hoverRu)
      // setPendingRu schedules a state update; handleDevicePick reads
      // pendingRu inside its body. We can't rely on the new state
      // being visible yet — pass the RU explicitly via a synthetic
      // pick that bypasses the pendingRu check by setting it just
      // before. Workaround: capture local + use directly.
      void handleDevicePickAtRu(preset, hoverRu)
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
    document.addEventListener('pointercancel', handleUp)
    return () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      document.removeEventListener('pointercancel', handleUp)
    }
  }, [dragPreset]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Click-bypass variant of handleDevicePick that uses an explicit
   *  RU instead of pendingRu state. Used by the drag-drop release
   *  path where pendingRu would lag behind the gesture. */
  async function handleDevicePickAtRu(preset: RackDevicePreset, ru: number) {
    if (!canEdit) return
    if (ru + preset.ruSize - 1 > rack.totalRU) {
      setError(`${preset.name} (${preset.ruSize}U) doesn't fit at RU ${ru}.`)
      return
    }
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
      setPendingRu(null)
      setSheetOpen(false)
      setAdding(false)
      router.refresh()
    } catch {
      setError('Network error')
      setAdding(false)
    }
  }

  function handleCustomDeviceDelete(deviceId: number, name: string) {
    if (!canEdit) return
    confirmDelete({
      title: 'Remove custom device',
      message: (
        <>
          Remove <span className="text-white font-medium">{name}</span> from the device library? Existing slots stay; the device just disappears from the picker.
        </>
      ),
      confirmLabel: 'Remove',
      onConfirm: async () => {
        setError(null)
        setCustomDeletingId(deviceId)
        try {
          const res = await fetch(`/api/rack-devices/${deviceId}`, { method: 'DELETE' })
          if (!res.ok) {
            const data = await res.json().catch(() => null)
            setError((data as { error?: string } | null)?.error ?? 'Failed to remove device')
            setCustomDeletingId(null)
            return
          }
          setCustomDeletingId(null)
          router.refresh()
        } catch {
          setError('Network error')
          setCustomDeletingId(null)
        }
      },
    })
  }

  async function handleCustomDeviceCreate(payload: { name: string; ruSize: number; category: PresetCategory }): Promise<boolean> {
    if (!canEdit) return false
    setError(null)
    try {
      const res = await fetch('/api/rack-devices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          dept,
          name: payload.name,
          ruSize: payload.ruSize,
          category: payload.category,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError((data as { error?: string } | null)?.error ?? 'Failed to create device')
        return false
      }
      setCustomFormOpen(false)
      router.refresh()
      return true
    } catch {
      setError('Network error')
      return false
    }
  }

  function handleLooseDelete(looseId: number, label: string) {
    if (!canEdit) return
    confirmDelete({
      title: 'Remove loose item',
      message: (
        <>
          Remove <span className="text-white font-medium">{label}</span> from the loose-gear tray?
        </>
      ),
      confirmLabel: 'Remove',
      onConfirm: async () => {
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
      },
    })
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

  function handleRackDelete() {
    if (!canEdit) return
    confirmDelete({
      title: 'Delete rack',
      message: (
        <>
          Delete rack <span className="text-white font-medium">{rack.name}</span>? Every slot and loose item attached to it goes with it. This can&apos;t be undone.
        </>
      ),
      onConfirm: async () => {
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
            onDeleted()
          } else {
            router.push(`/projects/${project.id}?tab=racks`)
          }
        } catch {
          setError('Network error')
          setRackSaving(false)
        }
      },
    })
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
        {/* Front/Rear moved into the device library's top row (paired
            with + Custom device). Nothing on the toolbar's left side
            anymore — pushes the tab dropdown / settings cog to the
            right via flex-1 spacer below. */}
        <div className="flex-1" />
        {/* Tab dropdown — only when the rack studio is a full page.
            In embedded mode the parent Comms page already owns the
            tab dropdown above, so we'd be doubling it up. */}
        {!embedded && (
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
            only; hidden in embedded mode (host row will surface the
            edit fields directly when expanded). */}
        {canEdit && !embedded && (
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
      </div>

      {/* ─── Rack settings panel ───
          Standalone-page only. Embedded mode surfaces the same
          inputs in the host row header instead, so we'd be doubling
          up if we rendered the panel here too. */}
      {settingsOpen && canEdit && !embedded && (
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
          No header / no empty-state copy — the chips speak for
          themselves. When the tray is empty the row collapses out
          entirely; when it has items they render as a wrap-flow row
          above the chassis. × on each chip removes (canEdit only). */}
      {looseItems.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
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
            <div className={`relative p-2 rounded-lg bg-[#2a2a2a] border border-white/[0.06] overflow-y-auto ${
              embedded
                // Embedded: cap at 70vh on mobile (where the tab scroll
                // does the heavy lifting), but on desktop fill the
                // viewport minus the chrome above (app header + Comms
                // header + tab toolbar + expanded row header ≈ 180px).
                // Without the lg override the chassis was capped at
                // 70vh even on tall monitors with hundreds of pixels
                // to spare — felt fixed-height.
                ? 'max-h-[70vh] lg:max-h-[calc(100vh-180px)]'
                // Standalone page: app header + page header + toolbar
                // adds ≈ 320px of chrome above.
                : 'max-h-[calc(100vh-320px)]'
            }`}>
              <div className="relative" style={{ height: `${containerHeight}px`, transition: 'height 180ms ease-out' }}>
                {/* Empty rows + RU numbers. Drag highlight is now a
                    single overlay rendered AFTER this map (so it
                    stacks on top of empty rows and filled slots in
                    the drop range), instead of styling each row
                    individually. */}
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
                      <div className="w-9 pl-1 text-left text-sm text-gray-400 font-mono tabular-nums">
                        {ru}
                      </div>
                      <div className="flex-1">
                        {isEmpty && (
                          <button
                            type="button"
                            data-rack-ru={ru}
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
                {/* Drag preview overlay — one bordered box spanning
                    the entire RU range the device would occupy.
                    Cyan when the drop would succeed, red when it
                    would fail (out-of-bounds or any RU in the
                    range is occupied). Centered text shows the
                    device name + RU size — no "drop" / "won't fit"
                    verbiage, the color tells the story. */}
                {dragPreset && dragHoverRu != null && (() => {
                  const start = dragHoverRu
                  const end = start + dragPreset.ruSize - 1
                  const fits = end <= rack.totalRU
                    && !Array.from({ length: dragPreset.ruSize }, (_, j) => occupied.has(start + j)).includes(true)
                  return (
                    <div
                      // Match the slot card geometry exactly so the
                      // preview reads as "this is where the slot
                      // would land if you released now."
                      style={{
                        position: 'absolute',
                        top: `${(start - 1) * RU_PX + 4 + offsetFor(start)}px`,
                        left: '40px',
                        right: 0,
                        height: `${dragPreset.ruSize * RU_PX - 2}px`,
                        zIndex: 5,
                        pointerEvents: 'none',
                      }}
                      className={`flex items-center justify-center rounded-lg border-2 ${
                        fits
                          ? 'border-[#22a7d3] bg-[#0178a3]/20 text-[#22a7d3]'
                          : 'border-red-500 bg-red-500/10 text-red-300'
                      } text-sm font-medium`}
                    >
                      <span>{dragPreset.name}</span>
                      <span className="ml-2 text-xs opacity-70">{dragPreset.ruSize}U</span>
                    </div>
                  )
                })()}
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
                      presets={libraryItems}
                      editSaving={editSaving}
                      setEditSaving={setEditSaving}
                      setError={setError}
                      onConfirmDelete={confirmDelete}
                      refreshAfter={() => { setEditingSlotId(null); router.refresh() }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Device library aside (desktop only).
            Sticks to the top of the scroll container so it stays in
            view when the rack header inputs scroll past — operators
            shouldn't have to scroll back up to drop another device.
            `self-start` keeps the aside at its natural height inside
            the grid row instead of stretching with the chassis,
            which would break sticky. */}
        <aside className={`hidden lg:flex lg:flex-col lg:sticky lg:top-0 lg:self-start ${embedded ? 'lg:max-h-[calc(100vh-180px)]' : 'lg:max-h-[calc(100vh-320px)]'}`}>
          <DeviceLibrary
            items={libraryItems}
            filter={filter}
            onFilterChange={setFilter}
            search={librarySearch}
            onSearchChange={setLibrarySearch}
            side={side}
            onSideChange={(v) => { setSide(v); setPendingRu(null) }}
            onPick={handleDevicePick}
            onStartDrag={startLibraryDrag}
            dragging={dragPreset}
            pendingRu={pendingRu}
            adding={adding}
            canEdit={canEdit}
            renderInSheet={false}
            customFormOpen={customFormOpen}
            onCustomFormOpenChange={setCustomFormOpen}
            onCustomCreate={handleCustomDeviceCreate}
            onCustomDelete={handleCustomDeviceDelete}
            customDeletingId={customDeletingId}
          />
        </aside>

      </div>

      {/* Mobile bottom-sheet — opens when user taps an empty RU row */}
      {sheetOpen && (
        <DeviceLibrarySheet
          onClose={() => { setSheetOpen(false); setPendingRu(null) }}
          items={libraryItems}
          filter={filter}
          onFilterChange={setFilter}
          search={librarySearch}
          onSearchChange={setLibrarySearch}
          side={side}
          onSideChange={(v) => { setSide(v); setPendingRu(null) }}
          onPick={handleDevicePick}
          onStartDrag={startLibraryDrag}
          dragging={dragPreset}
          pendingRu={pendingRu}
          adding={adding}
          canEdit={canEdit}
          customFormOpen={customFormOpen}
          onCustomFormOpenChange={setCustomFormOpen}
          onCustomCreate={handleCustomDeviceCreate}
          onCustomDelete={handleCustomDeviceDelete}
          customDeletingId={customDeletingId}
        />
      )}

      {/* Unified delete confirm. Replaces every window.confirm() call
          on rack-related destructive actions (slot delete, loose-gear
          ×, custom-device ×, rack delete) so the prompt is styled
          in-app and matches the project-delete modal pattern. */}
      <Modal
        open={!!deleteConfirm}
        title={deleteConfirm?.title ?? ''}
        onClose={confirmRunning ? undefined : () => setDeleteConfirm(null)}
        actions={
          <>
            <button
              type="button"
              onClick={() => setDeleteConfirm(null)}
              disabled={confirmRunning}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!deleteConfirm) return
                setConfirmRunning(true)
                try {
                  await deleteConfirm.onConfirm()
                } finally {
                  setConfirmRunning(false)
                  setDeleteConfirm(null)
                }
              }}
              disabled={confirmRunning}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmRunning ? 'Working…' : (deleteConfirm?.confirmLabel ?? 'Delete')}
            </button>
          </>
        }
      >
        {deleteConfirm?.message}
      </Modal>

      {/* Drag ghost — a fixed-position pill following the cursor
          while the user is mid-drag from a library tile. createPortal
          so it isn't clipped by the rack studio's overflow scrollers.
          pointer-events:none keeps it out of elementsFromPoint so the
          drop-target detection sees the chassis underneath. */}
      {dragPreset && dragPos && typeof document !== 'undefined' && createPortal(
        <div
          className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#22a7d3]/60 bg-[#0178a3]/30 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
          style={{ left: dragPos.x, top: dragPos.y }}
        >
          {dragPreset.name} <span className="ml-1 text-white/60">{dragPreset.ruSize}U</span>
        </div>,
        document.body,
      )}

    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
 * Device library list
 * ════════════════════════════════════════════════════════════════════ */

function DeviceLibrary({
  items,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  side,
  onSideChange,
  onPick,
  onStartDrag,
  dragging,
  pendingRu,
  adding,
  canEdit,
  renderInSheet,
  customFormOpen,
  onCustomFormOpenChange,
  onCustomCreate,
  onCustomDelete,
  customDeletingId,
}: {
  /** Library list = hard-coded presets merged with project-scoped
   *  custom devices. Customs carry an `id` + `isCustom: true` so the
   *  chip can offer a × delete. */
  items: readonly LibraryItem[]
  filter: 'all' | PresetCategory
  onFilterChange: (next: 'all' | PresetCategory) => void
  search: string
  onSearchChange: (next: string) => void
  /** Front/Rear toggle lives at the top of the library now —
   *  paired with the "+ Custom" button as the two halves
   *  of a single row. Lifted here from the rack-studio toolbar so
   *  the library is the canonical home for rack-context controls. */
  side: 'front' | 'rear'
  onSideChange: (next: 'front' | 'rear') => void
  onPick: (preset: RackDevicePreset) => void
  /** Pointer-down on a tile starts a library→rack drag. Provided
   *  by the parent so the global pointermove/up logic stays in one
   *  place; the tile just calls this on pointer down. */
  onStartDrag?: (preset: RackDevicePreset, e: React.PointerEvent) => void
  /** The device being dragged right now (if any). Tiles use this to
   *  visually fade their own state — the one being dragged stays
   *  full opacity, the others dim so the in-flight gesture is
   *  obvious. */
  dragging?: RackDevicePreset | null
  pendingRu: number | null
  adding: boolean
  canEdit: boolean
  renderInSheet: boolean
  /** + Custom device inline form state. Lifted to RackStudio so
   *  desktop + mobile share open/close. */
  customFormOpen: boolean
  onCustomFormOpenChange: (open: boolean) => void
  onCustomCreate: (payload: { name: string; ruSize: number; category: PresetCategory }) => Promise<boolean>
  onCustomDelete: (deviceId: number, name: string) => void | Promise<void>
  customDeletingId: number | null
}) {
  // Library search expand/collapse — local to the library (the
  // search term itself is parent-owned so it survives sheet
  // open/close, but the icon-vs-input toggle is a UI concern).
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false)
  // Filter pipeline — category narrows first, then search trims by
  // substring match on preset.name. Search is case-insensitive and
  // empty-string-safe.
  const q = search.trim().toLowerCase()
  const byCategory = filter === 'all' ? items : items.filter((p) => p.category === filter)
  const filtered = q.length === 0 ? byCategory : byCategory.filter((p) => p.name.toLowerCase().includes(q))
  // Skip the category-header layout when EITHER a category filter is
  // set OR a search is active — both modes mean "show me a flat list,
  // not grouped sections". Otherwise the user could see headers like
  // "Switches" with zero items because every item was filtered out.
  const showHeaders = filter === 'all' && q.length === 0

  return (
    <>
      {/* Top row — Front/Rear toggle on the left, + Custom device
          on the right, each half the row width. Same layout on
          mobile (inside the bottom sheet) and desktop (inside the
          aside). Front/Rear is sourced from props so the parent
          can also drive it from elsewhere if needed; defaults to
          drive the rack studio's side state. */}
      <div className="grid grid-cols-2 gap-2 mb-2 flex-shrink-0">
        <FilterDropdown
          ariaLabel="Rack side"
          value={side}
          onChange={(v) => onSideChange(v as 'front' | 'rear')}
          widthClass="w-full"
          options={[
            { value: 'front', label: 'Front' },
            { value: 'rear', label: 'Rear' },
          ]}
        />
        {/* + Custom — opens the inline create form below. Same
            neutral styling whether open or closed (no cyan
            highlight); the open state is communicated by the form
            appearing under the row, not by the button color. */}
        <button
          type="button"
          onClick={() => onCustomFormOpenChange(!customFormOpen)}
          disabled={!canEdit}
          aria-pressed={customFormOpen}
          className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Custom
        </button>
      </div>
      {/* Category dropdown + search-icon toggle on the right. Tap
          the magnifier and it swaps the dropdown for a text input
          (with an × to close) — same expand/collapse pattern the
          tab+search toolbar uses elsewhere in the app, so the
          interaction reads consistently. Live search-term state is
          held by the parent so the toggle doesn't drop the value. */}
      <div className="flex-shrink-0 mb-3 flex items-center gap-2">
        {librarySearchOpen ? (
          <>
            <input
              type="text"
              autoFocus
              placeholder="Search devices…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
            />
            <button
              type="button"
              onClick={() => { setLibrarySearchOpen(false); onSearchChange('') }}
              aria-label="Close search"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
            >
              <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </>
        ) : (
          <>
            <div className="flex-1">
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
            <button
              type="button"
              onClick={() => setLibrarySearchOpen(true)}
              aria-label="Search"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
            >
              <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.343-4.343m0 0A8 8 0 1 0 5.343 5.343a8 8 0 0 0 11.314 11.314Z" />
              </svg>
            </button>
          </>
        )}
      </div>
      {/* Inline + Custom create form. Slides open between the
          search/filter row and the device list. Closes itself on
          successful create (handler returns true) so the new
          device appears in the list right away. */}
      {customFormOpen && canEdit && (
        <div className="mb-3 flex-shrink-0">
          <CustomDeviceForm
            onCreate={onCustomCreate}
            onCancel={() => onCustomFormOpenChange(false)}
          />
        </div>
      )}
      <div
        className={`${renderInSheet ? '' : 'flex-1 min-h-0 overflow-y-auto pr-1'} space-y-3`}
        style={renderInSheet ? undefined : undefined}
      >
        {showHeaders ? (
          PRESET_CATEGORY_ORDER.map((cat) => {
            const sectionItems = items.filter((p) => p.category === cat)
            if (sectionItems.length === 0) return null
            return (
              <Section key={cat} label={PRESET_CATEGORY_LABELS[cat]}>
                {sectionItems.map((p) => (
                  <DeviceTile
                    key={p.isCustom ? `custom-${p.id}` : `preset-${p.name}`}
                    preset={p}
                    onClick={() => onPick(p)}
                    onPointerDown={onStartDrag ? (e) => onStartDrag(p, e) : undefined}
                    disabled={!canEdit || adding}
                    highlightTarget={pendingRu != null && p.ruSize > 0}
                    isDragging={!!dragging && dragging.name === p.name}
                    onDelete={p.isCustom && p.id != null && canEdit
                      ? () => onCustomDelete(p.id as number, p.name)
                      : undefined}
                    deleting={p.isCustom && p.id != null && customDeletingId === p.id}
                  />
                ))}
              </Section>
            )
          })
        ) : (
          <Section label={PRESET_CATEGORY_LABELS[filter as PresetCategory]} hideLabel>
            {filtered.map((p) => (
              <DeviceTile
                key={p.isCustom ? `custom-${p.id}` : `preset-${p.name}`}
                preset={p}
                onClick={() => onPick(p)}
                disabled={!canEdit || adding}
                highlightTarget={pendingRu != null && p.ruSize > 0}
                onDelete={p.isCustom && p.id != null && canEdit
                  ? () => onCustomDelete(p.id as number, p.name)
                  : undefined}
                deleting={p.isCustom && p.id != null && customDeletingId === p.id}
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
  onPointerDown,
  disabled,
  highlightTarget,
  isDragging,
  onDelete,
  deleting,
}: {
  preset: LibraryItem
  onClick: () => void
  /** Pointer-down kicks off a library→rack drag. Click still
   *  works (the click event fires after pointer up only if no
   *  drag occurred, since the parent's pointerup handler doesn't
   *  preventDefault). */
  onPointerDown?: (e: React.PointerEvent) => void
  disabled: boolean
  highlightTarget: boolean
  /** True when THIS tile is the one currently being dragged.
   *  Keeps the tile rendered (so the drag start position has
   *  somewhere to anchor) but visually marks it as in-flight. */
  isDragging?: boolean
  /** Provided only when this tile represents a custom device the
   *  viewer is allowed to delete. Renders a small × on the right
   *  edge that swallows the parent button click. */
  onDelete?: () => void
  deleting?: boolean
}) {
  const isLoose = preset.ruSize === 0
  return (
    <div className="relative flex items-stretch">
      <button
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        disabled={disabled}
        // touch-none disables the browser's default touch-scroll on
        // the tile so pointermove events get delivered cleanly on
        // mobile; without it the gesture scrolls the library instead
        // of dragging.
        style={onPointerDown ? { touchAction: 'none' } : undefined}
        className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
          disabled
            ? 'border-white/10 text-gray-500 cursor-not-allowed opacity-50'
            : isDragging
              ? 'border-[#22a7d3]/70 bg-[#0178a3]/15 text-[#22a7d3] opacity-70'
              : highlightTarget
                ? 'border-[#22a7d3]/50 text-gray-200 hover:bg-[#0178a3]/10'
                : 'border-white/15 text-gray-300 hover:border-white/25 hover:bg-white/[0.03]'
        }`}
      >
        <span className="truncate">{preset.name}</span>
        <span className={`ml-auto shrink-0 text-[10px] text-gray-500 ${onDelete ? 'mr-6' : ''}`}>
          {isLoose ? '—' : `${preset.ruSize}U`}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          disabled={deleting}
          aria-label={`Remove ${preset.name}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex size-5 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-red-400 disabled:opacity-30"
        >
          <svg className="size-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
 * Mobile bottom sheet
 * ════════════════════════════════════════════════════════════════════ */

function DeviceLibrarySheet({
  onClose,
  items,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  side,
  onSideChange,
  onPick,
  onStartDrag,
  dragging,
  pendingRu,
  adding,
  canEdit,
  customFormOpen,
  onCustomFormOpenChange,
  onCustomCreate,
  onCustomDelete,
  customDeletingId,
}: {
  onClose: () => void
  items: readonly LibraryItem[]
  filter: 'all' | PresetCategory
  onFilterChange: (next: 'all' | PresetCategory) => void
  search: string
  onSearchChange: (next: string) => void
  side: 'front' | 'rear'
  onSideChange: (next: 'front' | 'rear') => void
  onPick: (preset: RackDevicePreset) => void
  onStartDrag?: (preset: RackDevicePreset, e: React.PointerEvent) => void
  dragging?: RackDevicePreset | null
  pendingRu: number | null
  adding: boolean
  canEdit: boolean
  customFormOpen: boolean
  onCustomFormOpenChange: (open: boolean) => void
  onCustomCreate: (payload: { name: string; ruSize: number; category: PresetCategory }) => Promise<boolean>
  onCustomDelete: (deviceId: number, name: string) => void | Promise<void>
  customDeletingId: number | null
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
            items={items}
            filter={filter}
            onFilterChange={onFilterChange}
            search={search}
            onSearchChange={onSearchChange}
            side={side}
            onSideChange={onSideChange}
            onPick={onPick}
            onStartDrag={onStartDrag}
            dragging={dragging}
            pendingRu={pendingRu}
            adding={adding}
            canEdit={canEdit}
            renderInSheet
            customFormOpen={customFormOpen}
            onCustomFormOpenChange={onCustomFormOpenChange}
            onCustomCreate={onCustomCreate}
            onCustomDelete={onCustomDelete}
            customDeletingId={customDeletingId}
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
  onConfirmDelete,
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
  presets: readonly LibraryItem[]
  editSaving: boolean
  setEditSaving: (v: boolean) => void
  setError: (msg: string | null) => void
  /** Opens the parent's shared confirm modal. SlotRow uses this for
   *  the Delete affordance inside the edit form, replacing
   *  window.confirm so the prompt is styled in-app. */
  onConfirmDelete: (opts: {
    title: string
    message: React.ReactNode
    confirmLabel?: string
    onConfirm: () => void | Promise<void>
  }) => void
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

  function handleDelete() {
    onConfirmDelete({
      title: 'Delete slot',
      message: (
        <>
          Delete <span className="text-white font-medium">{slot.label}</span> from the rack?
        </>
      ),
      onConfirm: async () => {
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
      },
    })
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
        <div className="flex h-full w-full flex-col rounded-lg border border-[#3a3a3a] bg-[#202020] overflow-hidden">
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
        // Each slot is its own bordered card. Background +
        // border match the panel-studio key style so the rack
        // chassis reads visually consistent with PanelStudio.
        // Trimmed to just the label + Edit — deviceType usually
        // duplicates the label for preset devices, and the RU
        // range is implicit from the slot's position in the
        // chassis (the leftmost RU column already labels it).
        <div className="flex h-full w-full items-center gap-2 rounded-lg border border-[#3a3a3a] bg-[#202020] px-4 text-sm font-medium text-white">
          <span className="truncate">{slot.label}</span>
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

/* ════════════════════════════════════════════════════════════════════
 * CustomDeviceForm
 * Inline form rendered inside the device library when the user taps
 * + Custom. Collects name + RU size + category, POSTs to
 * /api/rack-devices. The save handler is provided by the parent and
 * returns a boolean so this form can clear its inputs only on
 * success (a failed save keeps the typed values for the operator to
 * fix and retry).
 * ════════════════════════════════════════════════════════════════════ */

function CustomDeviceForm({
  onCreate,
  onCancel,
}: {
  onCreate: (payload: { name: string; ruSize: number; category: PresetCategory }) => Promise<boolean>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [ruSizeStr, setRuSizeStr] = useState('1')
  const [category, setCategory] = useState<PresetCategory>('devices')
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    const trimmed = name.trim()
    if (!trimmed) { setLocalError('Name is required'); return }
    const ruSize = parseInt(ruSizeStr, 10)
    if (!Number.isFinite(ruSize) || ruSize < 0 || ruSize > 60) {
      setLocalError('RU size must be 0 (loose) or 1–60'); return
    }
    setSaving(true)
    const ok = await onCreate({ name: trimmed, ruSize, category })
    setSaving(false)
    if (ok) {
      setName('')
      setRuSizeStr('1')
      setCategory('devices')
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-white/10 p-3"
    >
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">New device</div>
      <div className="space-y-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
          placeholder="Device name"
          className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            min={0}
            max={60}
            value={ruSizeStr}
            onChange={(e) => setRuSizeStr(e.target.value)}
            disabled={saving}
            aria-label="RU size"
            placeholder="RU (0 = loose)"
            className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as PresetCategory)}
            disabled={saving}
            aria-label="Category"
            className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
          >
            {PRESET_CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>{PRESET_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        {localError && (
          <div className="text-[11px] text-red-300">{localError}</div>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#0178a3] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add device'}
          </button>
        </div>
      </div>
    </form>
  )
}

