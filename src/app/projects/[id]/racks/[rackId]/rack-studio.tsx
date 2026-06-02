'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { FilterDropdown } from '@/components/filter-dropdown'
import { Modal } from '@/components/modal'
import { showToast } from '@/components/toast'
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

/** A device shown in the library list. Three kinds, all unified
 *  under one shape so the filter / search / render pipeline doesn't
 *  branch:
 *    - Preset (hard-coded): just RackDevicePreset, no extras.
 *    - Custom (user-added): id + isCustom flag → × delete shown.
 *    - Equipment-backed (a real Equipment row on this project):
 *      equipmentId set + isEquipment flag → dropping this tile
 *      stamps slot.equipmentId at create time. Carries hardwareType
 *      for the small 'model' subtext on the tile. */
type LibraryItem = RackDevicePreset & {
  id?: number
  isCustom?: boolean
  equipmentId?: number
  isEquipment?: boolean
  hardwareType?: string | null
  /** Equipment.location — rendered cyan between the white id name
   *  and the gray model on equipment-backed tiles. */
  location?: string | null
}

/** Pared-down Equipment shape for the slot edit form's link picker.
 *  Only the fields needed to show the picker option + auto-fill
 *  the slot's deviceType / label when an equipment is selected. */
type RackEquipment = {
  id: number
  name: string
  category: string
  hardwareType: string | null
  location: string | null
  ipAddress: string | null
  deployStatus: string
}

const RU_PX = 48

export function RackStudio({
  project,
  userProjects,
  rack,
  slots,
  looseItems,
  customDevices = [],
  rackEquipment = [],
  rackedEquipmentIds = [],
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
  /** Rack-eligible Equipment rows for the slot edit form's link
   *  picker. Filtered upstream (panels / switches / audio for now). */
  rackEquipment?: RackEquipment[]
  /** Equipment ids already linked to ANY slot on this project. The
   *  picker dims these so an operator can't double-claim a unit. */
  rackedEquipmentIds?: number[]
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
  // Reverse flow: operator tapped a device tile first (without first
  // tapping an empty RU). The chassis lights up every empty row cyan
  // as a 'pick a slot' invite; the next tap on a row POSTs the slot.
  // Only one of pendingRu / pendingDevice is non-null at a time —
  // setting one clears the other.
  const [pendingDevice, setPendingDevice] = useState<LibraryItem | null>(null)
  const [adding, setAdding] = useState(false)
  // setError used to drive an inline red banner; now it just pipes
  // to the shared bottom-right toast queue. The shape stays
  // (msg: string | null) so every existing caller works unchanged:
  // null is a no-op (toasts auto-dismiss; no need to clear), and a
  // string fires an error toast.
  const setError = (msg: string | null) => {
    if (msg) showToast('error', msg)
  }
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
  const [dragPreset, setDragPreset] = useState<LibraryItem | null>(null)
  // When set, the drag originated from an EXISTING slot (move/reposition)
  // rather than a library tile (create). On drop we PATCH the slot's
  // ruPosition instead of POSTing a new slot. The slot's own RUs are
  // excluded from the collision check so it can land on top of itself
  // / a strict subset of its current footprint.
  const [dragSlotId, setDragSlotId] = useState<number | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [dragHoverRu, setDragHoverRu] = useState<number | null>(null)
  // Ref so the pointer handlers see the latest preset / hover without
  // re-binding on every state change.
  const dragStateRef = useRef<{ preset: LibraryItem | null; hoverRu: number | null }>({ preset: null, hoverRu: null })
  // Remembers whether the mobile library sheet was open at the
  // moment a drag started, so we can restore it after the drop —
  // mimicking PanelStudio's pickerSnap behavior where the sheet
  // gets out of the way during a drag and comes back for the next
  // pick. Ref (not state) so the close/reopen doesn't trigger an
  // extra render in the drag loop.
  const sheetWasOpenBeforeDragRef = useRef(false)
  /** Pending pointerdown on a library tile. Tap-vs-hold: we don't
   *  start an actual drag on pointerdown — only when the pointer
   *  has moved past a small distance threshold. If pointerup
   *  happens first with no movement, the click event fires
   *  naturally (→ arm the device via handleDevicePick). This lets
   *  a single library tile be both 'tap to arm' AND 'hold-and-drag'
   *  without the two gestures conflicting. */
  const pendingDragRef = useRef<{
    preset: LibraryItem
    startX: number
    startY: number
    pointerId: number
  } | null>(null)
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
  // Measured height of the editing slot's form body (in px). Slot
  // card reports its actual content height via a ResizeObserver
  // callback so the chassis math grows JUST enough to fit — no
  // dead space below the action row. Sensible default for the
  // first paint before measurement.
  const [editFormHeight, setEditFormHeight] = useState(180)
  // When a slot enters edit mode, scroll its card into view and
  // focus the first input. Matches the equipment / team / pick-list
  // edit-form pattern. Without this, tapping Edit on a slot that's
  // currently scrolled out of view would expand the form somewhere
  // off-screen and the operator wouldn't see it.
  useEffect(() => {
    if (editingSlotId == null) return
    // Wait past the slot card's 180ms height transition before
    // measuring + scrolling — scrollIntoView during the
    // transition uses the in-flight height (still small), so
    // bottom-row slots ended up only partially scrolled into
    // view. 220ms gives the transition time to settle.
    const t = window.setTimeout(() => {
      const card = document.querySelector<HTMLElement>(`[data-rack-slot-card="${editingSlotId}"]`)
      if (!card) return
      // Manual scroll on the explicit chassis scroll container
      // (data-rack-scroll-container). scrollIntoView's auto-
      // ancestor detection was picking the wrong scroller for
      // bottom-row slots on some viewports. Computing the offset
      // directly is deterministic.
      const container = card.closest<HTMLElement>('[data-rack-scroll-container]')
      if (container) {
        const cardRect = card.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        const offset = cardRect.top - containerRect.top + container.scrollTop
        container.scrollTo({ top: Math.max(0, offset - 12), behavior: 'smooth' })
      } else {
        // Fallback (mobile, no chassis scroll context — page
        // owns the scroll) — let the browser figure it out.
        card.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      card.querySelector<HTMLElement>('input:not([type="hidden"])')?.focus({ preventScroll: true })
    }, 220)
    return () => window.clearTimeout(t)
  }, [editingSlotId])
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
    // Equipment-backed tiles first so they sit at the TOP of their
    // category section in the rendered library (filter preserves
    // source order). Real units always read above generic templates.
    ...rackEquipment
      .filter((eq) => !rackedEquipmentIds.includes(eq.id))
      .map((eq) => {
        const matchingPreset = presets.find((p) => p.name === eq.hardwareType)
        const mappedCategory: PresetCategory =
          eq.category === 'switches' ? 'switches'
          : eq.category === 'audio' ? 'audio'
          : 'devices'
        // Equipment.name is the id-like label ('PNL 3' / 'SW 1');
        // the tile renders it white. Location + hardwareType ride
        // alongside in their own fields so the tile can color each
        // segment independently.
        return {
          name: eq.name?.trim() || `Equipment ${eq.id}`,
          ruSize: matchingPreset?.ruSize ?? 1,
          category: mappedCategory,
          equipmentId: eq.id,
          isEquipment: true as const,
          hardwareType: eq.hardwareType,
          location: eq.location,
        }
      }),
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
    // If a device is armed (operator tapped a library tile), the row
    // tap commits the POST — same validation as click-from-RU and
    // drag-drop. Otherwise the row click is intentionally silent:
    // no pendingRu state, no cyan highlight, no 'pick a device'
    // prompt. On mobile we still open the device library sheet so
    // the operator has a path to pick something; on desktop the
    // library is already visible on the left, so nothing happens.
    if (pendingDevice) {
      const preset = pendingDevice
      setPendingDevice(null)
      void handleDevicePickAtRu(preset, ru)
      return
    }
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      setSheetOpen(true)
    }
  }

  async function handleDevicePick(preset: LibraryItem) {
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
      // Reverse flow: no RU picked yet → arm this device instead.
      // Tap again on the same tile toggles it off. Setting
      // pendingDevice lights up every empty row cyan as a 'pick a
      // slot' invite; the next empty-row tap commits the POST via
      // handleEmptyRowClick. On mobile we also close the library
      // sheet so the chassis is visible for the next tap.
      if (pendingDevice?.name === preset.name) {
        setPendingDevice(null)
      } else {
        setPendingDevice(preset)
        setSheetOpen(false)
      }
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
          // Equipment-backed library tiles stamp slot.equipmentId.
          equipmentId: preset.equipmentId ?? null,
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

  /** Records a pointerdown on a library tile without starting an
   *  actual drag. The drag promotes to "active" only after the
   *  pointer moves past a small distance threshold (handled in the
   *  always-on pointermove effect below). Pointerup before move →
   *  click fires naturally → handleDevicePick arms the device. */
  function startLibraryDrag(preset: LibraryItem, e: React.PointerEvent) {
    if (!canEdit) return
    if (preset.ruSize === 0) return  // Loose gear: click-to-add only.
    pendingDragRef.current = {
      preset,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
    }
  }

  // Pre-drag listener (always on): converts a pending library
  // pointerdown into an active drag once the pointer moves past a
  // threshold. Pointerup with no movement → tap → handleDevicePick
  // runs via the button's natural onClick path.
  useEffect(() => {
    const THRESHOLD = 6  // px; ignores accidental finger jitter on tap
    function maybePromote(ev: PointerEvent) {
      const pending = pendingDragRef.current
      if (!pending || pending.pointerId !== ev.pointerId) return
      const dx = ev.clientX - pending.startX
      const dy = ev.clientY - pending.startY
      if (Math.hypot(dx, dy) <= THRESHOLD) return
      // Promote to active drag.
      const preset = pending.preset
      pendingDragRef.current = null
      setDragPreset(preset)
      setDragPos({ x: ev.clientX, y: ev.clientY })
      setDragHoverRu(null)
      dragStateRef.current = { preset, hoverRu: null }
      sheetWasOpenBeforeDragRef.current = sheetOpen
      if (sheetOpen) setSheetOpen(false)
    }
    function clearPending() {
      pendingDragRef.current = null
    }
    document.addEventListener('pointermove', maybePromote)
    document.addEventListener('pointerup', clearPending)
    document.addEventListener('pointercancel', clearPending)
    return () => {
      document.removeEventListener('pointermove', maybePromote)
      document.removeEventListener('pointerup', clearPending)
      document.removeEventListener('pointercancel', clearPending)
    }
  }, [sheetOpen])

  // Global pointer handlers for the active-drag phase. Effects
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
      const slotId = dragSlotId
      const restoreSheet = sheetWasOpenBeforeDragRef.current
      setDragPreset(null)
      setDragSlotId(null)
      setDragPos(null)
      setDragHoverRu(null)
      dragStateRef.current = { preset: null, hoverRu: null }
      sheetWasOpenBeforeDragRef.current = false
      // Restore the mobile library sheet (library drags only; slot
      // drags don't open the sheet so the restore is a no-op there).
      if (restoreSheet) setSheetOpen(true)
      if (!preset || hoverRu == null) return
      // Two release paths:
      //  - slotId set → PATCH the existing slot's ruPosition.
      //  - slotId null → POST a new slot from the library preset.
      if (slotId != null) {
        void handleSlotMoveToRu(slotId, hoverRu)
        return
      }
      setPendingRu(hoverRu)
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

  /** Initiates a drag from an EXISTING slot card (reposition).
   *  Synthesizes a RackDevicePreset from the slot so the drag UI
   *  (ghost, overlay, hover detection) reuses the library-drag
   *  pipeline; dragSlotId tracks the source so handleUp PATCHes
   *  the moved slot instead of POSTing a new one. */
  function startSlotDrag(slot: Slot, e: React.PointerEvent) {
    if (!canEdit) return
    const preset: RackDevicePreset = {
      name: slot.label,
      ruSize: slot.ruSize,
      category: 'devices',
    }
    setDragPreset(preset)
    setDragSlotId(slot.id)
    setDragPos({ x: e.clientX, y: e.clientY })
    setDragHoverRu(null)
    dragStateRef.current = { preset, hoverRu: null }
    // Slot drags don't open the mobile library sheet; the operator
    // is moving an existing slot, not picking a new device.
    sheetWasOpenBeforeDragRef.current = sheetOpen
    if (sheetOpen) setSheetOpen(false)
  }

  /** PATCH a slot's ruPosition. Called from handleUp's drag-end
   *  path when the source was a slot card (dragSlotId set). */
  async function handleSlotMoveToRu(slotId: number, ru: number) {
    if (!canEdit) return
    const slot = slots.find((s) => s.id === slotId)
    if (!slot) return
    if (ru === slot.ruPosition) return  // No-op move
    if (ru + slot.ruSize - 1 > rack.totalRU) {
      setError(`${slot.label} (${slot.ruSize}U) doesn't fit at RU ${ru}.`)
      return
    }
    // Collision check — exclude the slot's OWN RUs from occupied
    // so it can land partially on top of where it currently sits.
    const occupiedExcl = new Set<number>()
    for (const s of sideSlots) {
      if (s.id === slotId) continue
      for (let i = 0; i < s.ruSize; i++) occupiedExcl.add(s.ruPosition + i)
    }
    for (let i = 0; i < slot.ruSize; i++) {
      if (occupiedExcl.has(ru + i)) {
        setError(`RU ${ru + i} is already taken — pick another row.`)
        return
      }
    }
    setError(null)
    try {
      const res = await fetch(`/api/racks/${rack.id}/slots/${slotId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ruPosition: ru }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError((data as { error?: string } | null)?.error ?? 'Failed to move slot')
        return
      }
      router.refresh()
    } catch {
      setError('Network error')
    }
  }

  /** Click-bypass variant of handleDevicePick that uses an explicit
   *  RU instead of pendingRu state. Used by the drag-drop release
   *  path where pendingRu would lag behind the gesture. */
  async function handleDevicePickAtRu(preset: LibraryItem, ru: number) {
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
          // When the source library item was an Equipment-backed
          // tile, stamp equipmentId at create time so the link is
          // captured in one gesture — no follow-up edit needed.
          equipmentId: preset.equipmentId ?? null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError((data as { error?: string } | null)?.error ?? 'Failed to add device')
        setAdding(false)
        return
      }
      setPendingRu(null)
      // Drag-drop path leaves sheetOpen alone — handleUp already
      // restored the pre-drag state, so the sheet pops back up
      // ready for the operator to grab another device.
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
        // Embedded desktop: fill the parent (the expanded rack
        // row) so the inner main grid has a defined height to work
        // with. The toolbar / loose tray / etc. up top are
        // flex-shrink-0; the chassis + library grid below is
        // flex-1 min-h-0 and owns the scroll. Net effect: chrome
        // stays put, only chassis and library scroll.
        // Embedded mobile: NO flex-1 / min-h-0 — the chassis grows
        // to its natural totalRU * 48 height and the racks-tab
        // scroll body handles overflow. Constraining it on mobile
        // was clipping tall racks and could leave the chassis off-
        // screen during a drag-and-drop.
        ? 'flex w-full flex-col lg:min-h-0 lg:flex-1'
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
          Only renders in standalone mode (deep-link page). In
          embedded mode (inside the Comms Racks tab) it'd be
          completely empty — Front/Rear lives in the library top
          row, the tab dropdown lives on the parent Comms toolbar,
          the settings cog is gated on !embedded. py-4 of pure
          padding for no content was creating a 32px gap between
          the row header and the chassis below; pulling the whole
          row out closes that gap. */}
      {!embedded && (
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
      )}

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

      {/* Errors used to render here as an inline red banner; they
          now flow through showToast() and surface in the shared
          bottom-right toast queue. No inline UI needed. */}

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
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 lg:flex-1 lg:items-stretch lg:min-h-0">

        {/* Rack visualization. When a slot is being edited, every row
            BELOW its last occupied RU gets shifted down by
            EDIT_EXTRA_PX so the inline edit form has room. The
            container itself grows by the same amount so the bordered
            chassis still encloses everything. */}
        {(() => {
          const editingSlot = editingSlotId ? sideSlots.find((s) => s.id === editingSlotId) ?? null : null
          const editingEndRu = editingSlot ? editingSlot.ruPosition + editingSlot.ruSize - 1 : 0
          // Editing card height = the slot's normal height OR the
          // header (48px) + measured form body height, whichever is
          // larger. For 1U slots the form dwarfs the natural row,
          // so the card grows; for tall slots (6U+) the form fits
          // inside the natural area, no growth needed. Rows below
          // shift down by the difference (EDIT_EXTRA_PX).
          const naturalCardHeight = editingSlot ? editingSlot.ruSize * RU_PX - 2 : 0
          const editingCardHeight = editingSlot ? Math.max(naturalCardHeight, 48 + editFormHeight) : 0
          const EDIT_EXTRA_PX = editingSlot ? Math.max(0, editingCardHeight - naturalCardHeight) : 0
          const offsetFor = (ru: number) => editingSlot && ru > editingEndRu ? EDIT_EXTRA_PX : 0
          const containerHeight = rack.totalRU * RU_PX + 8 + EDIT_EXTRA_PX
          return (
            <div data-rack-scroll-container className={`relative lg:order-2 ${
              embedded
                // Embedded mobile: no max-h at all — the chassis
                // grows to its natural height (totalRU * 48 +
                // padding) and the parent racks-tab scroll body
                // handles overflow. A 48 RU rack on a tall phone
                // shows as much as the screen can fit; the user
                // page-scrolls to see the rest.
                // Embedded desktop: fills the grid cell via
                // lg:h-full + lg:min-h-0 + overflow-y-auto.
                ? 'lg:h-full lg:min-h-0 lg:overflow-y-auto'
                // Standalone page: app header + page header +
                // toolbar adds ≈ 320px of chrome above.
                : 'max-h-[calc(100vh-320px)] overflow-y-auto'
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
                  // Row is "pending" ONLY when a device is armed AND
                  // the device would actually fit at this RU (in
                  // bounds + no occupied overlap). Highlighting rows
                  // where the drop would fail was misleading — the
                  // operator would tap and just get an error toast.
                  const wouldFit = (() => {
                    if (pendingDevice == null) return false
                    if (ru + pendingDevice.ruSize - 1 > rack.totalRU) return false
                    for (let i = 0; i < pendingDevice.ruSize; i++) {
                      if (occupied.has(ru + i)) return false
                    }
                    return true
                  })()
                  const isPending = pendingDevice != null && wouldFit
                  return (
                    <div
                      key={`ru-${ru}`}
                      // data-rack-ru on every row wrapper (not just
                      // empty buttons) so the drag-drop hover
                      // detection finds an RU regardless of whether
                      // the row is currently occupied. The slot
                      // cards above get pointer-events:none during a
                      // drag so events pass through to this wrapper.
                      // Validity (collision / out-of-bounds) is
                      // checked at drop time in handleUp, where the
                      // dragSlotId is excluded from 'occupied'.
                      data-rack-ru={ru}
                      style={{
                        position: 'absolute',
                        top: `${i * RU_PX + 4 + offsetFor(ru)}px`,
                        left: 0,
                        right: 0,
                        height: `${RU_PX}px`,
                        transition: 'top 180ms ease-out',
                      }}
                    >
                      {isEmpty ? (
                        // The RU number now lives INSIDE the button —
                        // same structure as the occupied slot cards.
                        // Button hover/pending styles cascade through
                        // both spans (RU + label) via inherited text
                        // color, so the two halves light up as one
                        // unit. data-rack-ru stays on the button so
                        // the drag-drop hit-detection still finds it.
                        <button
                          type="button"
                          data-rack-ru={ru}
                          onClick={() => handleEmptyRowClick(ru)}
                          disabled={!canEdit}
                          className={`flex h-[46px] w-full items-center text-sm font-medium transition-colors disabled:cursor-default ${
                            // Always render the row chrome (border,
                            // text, hover) regardless of drag state.
                            // The drag overlay above is opaque and
                            // covers ONLY the rows in the drop range,
                            // so the surrounding rows must stay fully
                            // visible to keep the operator oriented.
                            isPending
                              ? 'rounded-lg border border-[#0178a3]/60 bg-[#0178a3]/15 text-[#22a7d3]'
                              : `border-b border-white/[0.06] text-gray-600 ${canEdit ? 'hover:border-b-[#0178a3]/40 hover:text-[#22a7d3] hover:bg-[#0178a3]/[0.04]' : ''}`
                          } ${canEdit ? 'cursor-pointer' : ''}`}
                        >
                          <span className="w-9 shrink-0 text-center text-sm font-mono tabular-nums">
                            {ru}
                          </span>
                          <span className="flex-1 text-center">
                            {isPending && pendingDevice
                              ? `+ Drop ${pendingDevice.name} here`
                              : 'Empty'}
                          </span>
                          {/* Invisible Edit-button-shaped placeholder
                              + matching pr-4 — keeps the label
                              centered at the same X as filled slot
                              cards (which have a real Edit button
                              on the right). Without it the empty
                              label drifted to the right relative to
                              labels in placed slots. */}
                          <span
                            aria-hidden
                            className="invisible shrink-0 rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium mr-2"
                          >
                            Edit
                          </span>
                        </button>
                      ) : (
                        // Occupied row — the slot card overlay covers
                        // this space. Render just an empty placeholder
                        // so the chassis grid math (containerHeight)
                        // stays correct.
                        <div className="h-[46px]" />
                      )}
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
                  // Slot-move: exclude the slot's OWN RUs from
                  // the occupied set so it can drop partially on
                  // top of where it currently sits without
                  // flagging itself as a collision.
                  const occupiedForDrop = new Set<number>()
                  for (const s of sideSlots) {
                    if (dragSlotId != null && s.id === dragSlotId) continue
                    for (let i = 0; i < s.ruSize; i++) occupiedForDrop.add(s.ruPosition + i)
                  }
                  const fits = end <= rack.totalRU
                    && !Array.from({ length: dragPreset.ruSize }, (_, j) => occupiedForDrop.has(start + j)).includes(true)
                  return (
                    <div
                      // Match the slot card geometry exactly so the
                      // preview reads as "this is where the slot
                      // would land if you released now."
                      style={{
                        position: 'absolute',
                        top: `${(start - 1) * RU_PX + 4 + offsetFor(start)}px`,
                        left: 0,
                        right: 0,
                        height: `${dragPreset.ruSize * RU_PX - 2}px`,
                        zIndex: 5,
                        pointerEvents: 'none',
                      }}
                      className={`flex items-stretch rounded-lg border-2 ${
                        // Solid fill so the preview cleanly masks the
                        // rows it covers (existing slot cards, empty-
                        // row chrome, RU labels) without those
                        // bleeding through. Other rows outside the
                        // drop range stay fully visible.
                        fits
                          ? 'border-[#22a7d3] bg-[#0178a3] text-white'
                          : 'border-red-500 bg-red-500 text-white'
                      } text-sm font-medium`}
                    >
                      {/* RU column: one number per RU the device
                          would occupy, evenly distributed top-to-
                          bottom over the overlay so each row's slot
                          number reads as 'covered by this drop'. */}
                      <span className="w-9 shrink-0 flex flex-col items-center justify-around py-1 font-mono tabular-nums text-sm">
                        {Array.from({ length: dragPreset.ruSize }, (_, i) => (
                          <span key={i}>{start + i}</span>
                        ))}
                      </span>
                      <span className="flex-1 flex items-center justify-center">
                        {dragPreset.name}
                        <span className="ml-2 text-xs opacity-70">{dragPreset.ruSize}U</span>
                      </span>
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
                      onStartDrag={startSlotDrag}
                      isDragging={dragSlotId === s.id}
                      anyDragActive={dragPreset != null}
                      rackEquipment={rackEquipment}
                      rackedEquipmentIds={rackedEquipmentIds}
                      onMeasureEditFormHeight={isEditing ? setEditFormHeight : undefined}
                      refreshAfter={() => { setEditingSlotId(null); router.refresh() }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Device library aside (desktop only).
            Embedded: fills its grid cell via lg:h-full + lg:min-h-0
            (the outer flex chain caps the total studio height; the
            library's inner device list owns the scroll inside).
            Standalone: keeps a viewport-relative max-h since there's
            no flex parent constraining its height. */}
        <aside className={`hidden lg:flex lg:flex-col lg:order-1 ${embedded ? 'lg:h-full lg:min-h-0' : 'lg:max-h-[calc(100vh-320px)]'}`}>
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
            dragging={dragPreset ?? pendingDevice}
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
  onPick: (preset: LibraryItem) => void
  /** Pointer-down on a tile starts a library→rack drag. Provided
   *  by the parent so the global pointermove/up logic stays in one
   *  place; the tile just calls this on pointer down. */
  onStartDrag?: (preset: LibraryItem, e: React.PointerEvent) => void
  /** The device being dragged right now (if any). Tiles use this to
   *  visually fade their own state — the one being dragged stays
   *  full opacity, the others dim so the in-flight gesture is
   *  obvious. */
  dragging?: LibraryItem | null
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
        // Device list scrolls in its own container on BOTH surfaces
        // — desktop aside and mobile sheet — so the top controls
        // above can stay pinned (flex-shrink-0) while the list
        // slides under them.
        className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3"
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
                    highlightTarget={false}
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
        // Same row geometry as PanelStudio's pick-list cards
        // (rounded-[10px], px-3.5 py-3, text-sm, gap-3,
        // border-white/[0.08]) — but the fill is the panel CHASSIS
        // tone (#2a2a2a) instead of the panel KEY tone, so the
        // device library reads as a stack of chassis-colored tiles
        // sitting on the page bg.
        className={`flex w-full items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left text-sm transition-colors select-none ${
          disabled
            ? 'border-white/[0.08] text-gray-500 cursor-not-allowed opacity-50'
            : isDragging
              ? 'border-[#0178a3] bg-[#0178a3] text-white'
              : highlightTarget
                // A slot is pending (operator tapped an empty RU);
                // every droppable device lights up cyan so the next
                // tap action reads as 'pick this for that slot'.
                ? 'border-[#22a7d3] text-[#22a7d3] hover:bg-[#0178a3]/10'
                : 'border-white/[0.08] text-gray-300 hover:border-[rgba(34,167,211,0.5)] hover:bg-white/[0.03]'
        }`}
      >
        {/* Equipment-backed tile: three pieces on one row,
            colored independently — id (white) · location (cyan) ·
            model (gray). Each segment truncates so the row
            doesn't blow out the tile width. Presets just render
            their single name in default text color. */}
        {preset.isEquipment ? (
          <span className="min-w-0 flex items-baseline gap-2">
            <span className="truncate text-white">{preset.name}</span>
            {preset.location && (
              <span className="truncate text-[#22a7d3]">{preset.location}</span>
            )}
            {preset.hardwareType && (
              <span className="truncate text-[11px] text-gray-500">{preset.hardwareType}</span>
            )}
          </span>
        ) : (
          <span className="truncate">{preset.name}</span>
        )}
        <span className={`ml-auto shrink-0 text-xs font-mono tabular-nums ${isDragging ? 'text-white' : 'text-[#22a7d3]'} ${onDelete ? 'mr-6' : ''}`}>
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
  onPick: (preset: LibraryItem) => void
  onStartDrag?: (preset: LibraryItem, e: React.PointerEvent) => void
  dragging?: LibraryItem | null
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
    // Two siblings styled to match PanelStudio's mobile picker
    // exactly: a tinted scrim at z-[199] (tap to close), and the
    // sheet itself at z-[200] with the same rounded corners, shadow,
    // drag-handle pill, header padding + size-12 close-X, and body
    // gutter. Different visual surfaces (chassis vs panel) but the
    // chrome should read as the same component.
    <>
      <div
        className="fixed inset-0 z-[199] lg:hidden bg-black/50 transition-colors duration-200"
        onClick={onClose}
      />
      <div
        className="fixed left-0 right-0 bottom-0 z-[200] max-h-[92vh] lg:hidden flex w-full flex-col overflow-hidden rounded-t-[20px] bg-[#202020] shadow-[0_-10px_40px_rgba(0,0,0,0.6)]"
      >
        {/* Drag-handle pill — same size + color as PanelStudio's
            (h-1.5 w-12 / bg-white/60 / pt-3 pb-2). Tap to close
            stays for now since the rack sheet doesn't support
            drag-snap states yet — a single tap on the handle is
            the next-best dismiss affordance. */}
        <div
          onClick={onClose}
          className="flex flex-shrink-0 cursor-pointer items-center justify-center pt-3 pb-2 select-none"
          aria-label="Tap to close"
        >
          <div className="h-1.5 w-12 rounded-full bg-white/60" />
        </div>
        {/* Header — px-[18px] py-4, border-b, size-12 close button.
            Layout matches PanelStudio's picker header so the two
            surfaces read as siblings. */}
        <div className="flex flex-shrink-0 items-center justify-between gap-2.5 border-b border-white/[0.06] px-[18px] py-4">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white">
              {pendingRu != null ? `Pick a device for RU ${pendingRu}` : 'Device library'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close picker"
            className="flex size-12 shrink-0 items-center justify-center rounded-md bg-transparent text-3xl text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            &times;
          </button>
        </div>
        {/* Body is a flex column now (not a scroll context). The
            DeviceLibrary's top controls (Front/Rear + Custom row,
            category + search row) are flex-shrink-0 inside; only
            the device list section grows + scrolls. Net effect:
            filters stay pinned at the top of the sheet while the
            list slides under them. */}
        <div className="flex-1 min-h-0 flex flex-col px-[18px] py-4">
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
    </>,
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
  onStartDrag,
  isDragging,
  anyDragActive,
  rackEquipment,
  rackedEquipmentIds,
  onMeasureEditFormHeight,
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
  /** Pointer-down on the slot card starts a slot-move drag (RackStudio
   *  handles ghost rendering, hover detection, and the PATCH on
   *  release). Only fires when canEdit. */
  onStartDrag?: (slot: Slot, e: React.PointerEvent) => void
  /** True when THIS slot is the source of an in-flight drag. Dims
   *  the card at its origin so the operator sees 'this is what's
   *  moving' while the ghost tracks the cursor. On release (whether
   *  the drop succeeds or gets rejected) RackStudio clears
   *  dragSlotId, isDragging flips false, the card returns to full
   *  opacity — which reads as 'snapped back' if the drop was
   *  rejected and 'left behind' if the drop landed elsewhere
   *  (the router.refresh then re-renders the slot at its new RU). */
  isDragging?: boolean
  /** True when ANY drag is in flight (library tile OR another slot
   *  card). When set, this slot card disables pointer events so
   *  hover detection passes through to the underlying row's
   *  data-rack-ru. Without this, dragging a slot across its own
   *  footprint (or onto another slot) found no drop target since
   *  the card itself caught the events. */
  anyDragActive?: boolean
  /** Rack-eligible equipment for the link picker inside the edit
   *  form. Empty when no project context (deep-link page without
   *  equipment fetch). */
  rackEquipment?: RackEquipment[]
  /** Equipment ids already linked to another slot. Picker dims
   *  these so the operator can't accidentally double-claim — the
   *  current slot's own equipmentId is exempted at render time so
   *  the active link doesn't dim itself. */
  rackedEquipmentIds?: number[]
  /** Reports the measured pixel height of the form body to the
   *  parent so the chassis can grow the editing card to fit
   *  exactly its content — no fixed EDIT_EXTRA_PX, no dead space
   *  below the action row. Only provided to the slot that's
   *  currently being edited; other slots pass undefined. */
  onMeasureEditFormHeight?: (px: number) => void
  refreshAfter: () => void
}) {
  // Local form state — only relevant while editing. Initialized from
  // the slot's current values; mutated on input; sent to the API on
  // Save.
  const [deviceType, setDeviceType] = useState(slot.deviceType)
  const [label, setLabel] = useState(slot.label)
  // Ref on the form body div for height measurement. When this
  // slot is being edited, a ResizeObserver reports the measured
  // pixel height back to RackStudio so the chassis math can grow
  // the editing card exactly to fit — no fixed EDIT_EXTRA_PX, no
  // empty space below the action row.
  const formBodyRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!isEditing || !onMeasureEditFormHeight) return
    const el = formBodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // scrollHeight = the form body's NATURAL content height, even
    // when the parent card constrains the visible area. Lets the
    // measurement loop converge: report scrollHeight → parent
    // grows the card → form body's visible (offsetHeight) catches
    // up. Stable after one frame.
    const report = () => onMeasureEditFormHeight(el.scrollHeight)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isEditing, onMeasureEditFormHeight])
  // Equipment link — '' means "no link", otherwise an Equipment row id.
  const [equipmentId, setEquipmentId] = useState<string>(
    slot.equipmentId != null ? String(slot.equipmentId) : ''
  )

  async function handleSave() {
    setError(null)
    setEditSaving(true)
    try {
      // RU position + RU size are NOT included — they were set at
      // create time and the chassis depends on them being stable.
      // Resize / reposition happens via the drag pipeline on the
      // chassis itself, not this form.
      const res = await fetch(`/api/racks/${rackId}/slots/${slot.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deviceType,
          label: label.trim() || deviceType,
          equipmentId: equipmentId === '' ? null : parseInt(equipmentId, 10),
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
    // No confirm prompt — operator explicitly tapped Delete on the
    // slot's own edit form, so the intent is unambiguous. Direct
    // DELETE keeps the gesture fast (especially when cleaning up
    // multiple slots in a row).
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
      data-rack-slot-card={slot.id}
      style={{
        position: 'absolute',
        top: `${topPx}px`,
        left: 0,
        right: 0,
        height: `${heightPx}px`,
        zIndex: isEditing ? 10 : 1,
        transition: 'top 180ms ease-out, height 180ms ease-out',
        // During an active drag (this slot OR another / a library
        // tile), the card stops catching pointer events so
        // findHoverRu (elementsFromPoint) sees the row wrapper's
        // data-rack-ru underneath. Without this you couldn't drop
        // onto a row your slot already covered, or onto another
        // slot's footprint to swap.
        pointerEvents: anyDragActive ? 'none' : undefined,
      }}
    >
      {isEditing ? (
        <div className="flex h-full w-full flex-col rounded-lg bg-[#2a2a2a] overflow-hidden">
          {/* Header row — mirrors the read-only row layout so the
              card reads continuous when expanded. */}
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/[0.08] pr-4 text-sm font-medium text-white"
               style={{ height: '48px' }}>
            <span className="w-9 shrink-0 text-center text-sm font-mono tabular-nums text-[#22a7d3]">{slot.ruPosition}</span>
            <span className="truncate">{slot.label}</span>
            <span className="text-gray-600">·</span>
            <span className="text-[11px] font-normal text-gray-500 truncate">{slot.deviceType}</span>
            <span className="ml-auto text-[11px] font-normal text-gray-500 font-mono tabular-nums">{ruSpan}</span>
          </div>
          {/* Form body */}
          <div ref={formBodyRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {/* Slot edit form. RU position + RU size aren't editable
                here — those were determined at create time (drag-drop
                / click-to-add) and the chassis math depends on them
                being stable. Resize / reposition happens via the
                drag pipeline on the chassis itself, not this form.
                Form contents depend on whether the slot is linked
                to an Equipment row:
                  - Linked: a single FilterDropdown showing same-
                    category equipment for swap. Label/deviceType
                    derive from the linked equipment.
                  - Unlinked: Device type (FilterDropdown of presets
                    + customs) + freeform Label input. */}
            {(() => {
              const linkedEq = slot.equipmentId != null
                ? rackEquipment?.find((eq) => eq.id === slot.equipmentId)
                : null
              if (linkedEq && rackEquipment && rackEquipment.length > 0) {
                // LINKED MODE — swap-to-equivalent picker.
                const swapOptions = rackEquipment
                  // Same category as the current link AND not racked
                  // elsewhere (but include the slot's own current
                  // link so the selected value renders).
                  .filter((eq) =>
                    eq.category === linkedEq.category &&
                    (!rackedEquipmentIds?.includes(eq.id) || eq.id === slot.equipmentId)
                  )
                  .map((eq) => {
                    const parts = [eq.name, eq.location, eq.hardwareType].filter(Boolean) as string[]
                    return {
                      value: String(eq.id),
                      label: parts.join(' · '),
                    }
                  })
                return (
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Linked equipment</div>
                    <FilterDropdown
                      ariaLabel="Linked equipment"
                      value={equipmentId}
                      onChange={(v) => {
                        setEquipmentId(v)
                        const picked = rackEquipment.find((eq) => String(eq.id) === v)
                        if (picked) {
                          // Mirror the picked equipment into label
                          // + deviceType so the slot's stored fields
                          // stay in sync (chassis/library lookups
                          // fall back to slot.label when an
                          // equipment ref disappears).
                          setLabel(picked.name)
                          if (picked.hardwareType) setDeviceType(picked.hardwareType)
                        }
                      }}
                      widthClass="w-full"
                      options={swapOptions}
                    />
                  </div>
                )
              }
              // UNLINKED MODE — preset/custom picker + freeform label.
              // (presets prop on SlotRow is the merged libraryItems
              // from RackStudio; equipment-backed entries get filtered
              // out here since the unlinked picker is for templates,
              // not real units — those use the Linked mode.)
              const presetOptions = presets
                .filter((p) => p.ruSize > 0 && !p.isEquipment)
                .map((p) => ({ value: p.name, label: `${p.name} · ${p.ruSize}U` }))
              // Include the slot's current deviceType even if it's
              // not in the preset list (e.g. a custom device that's
              // been deleted) so the dropdown can still show what's
              // there without forcing an immediate change.
              if (!presetOptions.some((o) => o.value === deviceType)) {
                presetOptions.unshift({ value: deviceType, label: `${deviceType} (custom)` })
              }
              return (
                <>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Device type</div>
                    <FilterDropdown
                      ariaLabel="Device type"
                      value={deviceType}
                      onChange={(v) => setDeviceType(v)}
                      widthClass="w-full"
                      options={presetOptions}
                    />
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
                </>
              )
            })()}
            {/* Action row — on desktop, all three buttons cluster
                on the right (Delete · Cancel · Save) so the
                destructive action sits next to its escape hatch.
                On mobile they stack full-width. */}
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={editSaving}
                className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={editSaving}
                className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-50 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={editSaving}
                className="w-full rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        // Each slot is its own bordered card spanning the full
        // chassis width. The RU number sits inside on the left,
        // then the label, then the Edit button on the right.
        // Pointer-down on the card (excluding the Edit button)
        // starts a slot-move drag — RackStudio's drag pipeline
        // handles the ghost / hover / drop-zone overlay, then
        // PATCHes ruPosition on release.
        <div
          onPointerDown={canEdit && onStartDrag ? (e) => onStartDrag(slot, e) : undefined}
          style={canEdit && onStartDrag ? { touchAction: 'none', cursor: 'grab' } : undefined}
          // Dim + dashed border while the card is the drag source.
          // On release, isDragging flips false; if the drop was
          // rejected (collision / out-of-bounds) the card snaps
          // back to full opacity in place. If the drop succeeded,
          // router.refresh re-renders it at the new RU.
          className={`flex h-full w-full items-center gap-2 rounded-lg pr-4 text-sm font-medium text-white transition-opacity select-none ${
            isDragging
              ? 'bg-[#2a2a2a] opacity-40 outline-dashed outline-2 outline-white/20'
              : 'bg-[#2a2a2a]'
          }`}
        >
          {/* RU column: one number per RU the slot occupies, stacked
              top-to-bottom and spread across the full card height
              (self-stretch overrides the parent's items-center so
              this column fills the card vertically while other
              content stays centered). Each number sits roughly at
              its real 48px row position via flex justify-around +
              equal child spacing. */}
          <span className="w-9 shrink-0 self-stretch flex flex-col items-center justify-around py-1 font-mono tabular-nums text-sm text-[#22a7d3]">
            {Array.from({ length: slot.ruSize }, (_, i) => (
              <span key={i}>{slot.ruPosition + i}</span>
            ))}
          </span>
          {(() => {
            // When the slot is linked to an Equipment row, mirror
            // the library-tile layout: id (white) · location (cyan)
            // · model (gray) on one row. Otherwise fall back to the
            // slot's freeform label.
            const linkedEq = slot.equipmentId != null
              ? rackEquipment?.find((eq) => eq.id === slot.equipmentId)
              : null
            // flex-1 + justify-center centers the device label
            // between the RU column on the left and the Edit
            // button on the right.
            if (linkedEq) {
              return (
                <span className="min-w-0 flex-1 flex items-baseline justify-center gap-2">
                  <span className="truncate text-white">{linkedEq.name}</span>
                  {linkedEq.location && (
                    <span className="truncate text-[#22a7d3]">{linkedEq.location}</span>
                  )}
                  {linkedEq.hardwareType && (
                    <span className="truncate text-[11px] text-gray-500">{linkedEq.hardwareType}</span>
                  )}
                </span>
              )
            }
            return <span className="min-w-0 flex-1 truncate text-center">{slot.label}</span>
          })()}
          {canEdit && (
            <button
              type="button"
              // Stop the pointerdown from bubbling to the card so
              // tapping Edit doesn't kick off a drag instead of
              // opening the edit form.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onOpenEdit}
              // ml-auto removed — the label span above is flex-1
              // so it already pushes the Edit button to the right
              // edge of the card.
              className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
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

