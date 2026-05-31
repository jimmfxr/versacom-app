'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useTransition, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { ChevronLeftIcon } from '@heroicons/react/24/outline'
import { EyeIcon, PencilIcon } from '@heroicons/react/16/solid'
import { PageHeader } from '@/components/page-header'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core'
import { useDrag } from '@use-gesture/react'

/* dnd-kit modifier: pin the centre of the dragged chip to the cursor.
 * Without this the chip floats at whatever offset the user clicked,
 * which on a small chip looks like the preview is "lagging" off to
 * the side. Centre-snap makes the preview feel attached to the
 * pointer regardless of where on the chip the user grabbed. */
const snapCenterToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!activatorEvent || !draggingNodeRect) return transform
  let pointerX = 0
  let pointerY = 0
  const ev = activatorEvent as PointerEvent | MouseEvent | TouchEvent
  if ('touches' in ev && ev.touches.length > 0) {
    pointerX = ev.touches[0].clientX
    pointerY = ev.touches[0].clientY
  } else if ('clientX' in ev) {
    pointerX = (ev as MouseEvent).clientX
    pointerY = (ev as MouseEvent).clientY
  } else {
    return transform
  }
  const offsetX = pointerX - draggingNodeRect.left
  const offsetY = pointerY - draggingNodeRect.top
  return {
    ...transform,
    x: transform.x + offsetX - draggingNodeRect.width / 2,
    y: transform.y + offsetY - draggingNodeRect.height / 2,
  }
}
import { Button } from '@/components/button'
import { usePanelPresence } from '@/hooks/use-panel-presence'
import { showToast } from '@/components/toast'
import { VerticalScroller } from '@/components/vertical-scroller'
import { saveKeys, saveDraftKeys, submitChanges, addExpansion, removeExpansion, resolveChangeRequests } from './actions'

/** Drag payload shapes attached via dnd-kit `data` so the drop handler can
 *  branch between picklist drops and key swaps without keeping its own
 *  parallel state. */
type KeyDragData = { kind: 'key'; sourceId: string }
type PicklistDragData = { kind: 'picklist'; item: PickerItem }
type DragData = KeyDragData | PicklistDragData

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface PanelStudioProps {
  userName: string
  isAdminGlobal: boolean
  isUserOnly: boolean
  equipment: {
    id: number
    name: string
    category: string
    hardwareType: string | null
    ipAddress: string | null
    location: string | null
  }
  member: {
    id: number
    firstName: string
    lastName: string
    position: string | null
    location: string | null
  } | null
  project: {
    id: number
    name: string
  }
  panelKeys: Array<{
    id: number
    keyIndex: number
    page: string
    expansion: number
    label: string
    triggerMode: string
    talkMode: string
    pickListItemId: number | null
    pickListItemName: string | null
    pickListItemType: string | null
  }>
  pickListItems: Array<{
    id: number
    code: string | null
    name: string
    type: string
  }>
  ptpMembers: Array<{
    id: number
    name: string
    position: string | null
  }>
  currentUserRole: string
  canEditKeys: boolean
  canManageExpansions: boolean
  showIpAddress: boolean
  isRequestMode: boolean
  currentUserId: number
  currentMemberId: number | null
  pendingChangeRequests?: Array<{
    id: number
    status: string
    submitterName: string
    submitterRole: string
    createdAt: string
    items: Array<{
      id: number
      panelKeyId: number
      fieldChanged: string
      previousValue: string | null
      previousValueName: string | null
      newValue: string | null
      newValueName: string | null
      keyIndex: number
      page: string
      expansion: number
    }>
  }>
  /**
   * Slots that have an unresolved change request submitted by the current
   * user for THIS equipment. Used to restore the green "submitted" border
   * when the user navigates away and back to this panel — without this,
   * the in-memory `keys` state forgets which keys were pending.
   */
  pendingSubmittedSlots?: Array<{
    keyIndex: number
    page: string
    expansion: number
    pickListItemId: number | null
    triggerMode: string | null
    talkMode: string | null
  }>
  /**
   * Change requests for this member that were resolved in the last 60s.
   * Only populated when the viewer is looking at their OWN panel. Used to
   * show an approval / denial toast when polling detects a resolution.
   */
  recentResolutions?: Array<{
    id: number
    resolvedAt: string
    items: Array<{
      keyIndex: number
      page: string
      expansion: number
      approved: boolean
    }>
  }>
  /** Browse mode (set when admin/manager arrives via /my-equipment).
   *  Drives the project + user dropdowns, prev/next, and sibling-gear row
   *  rendered above the panel keys. */
  browseProjects?: Array<{ id: number; name: string; firstEquipmentId: number | null }>
  browseMembers?: Array<{
    /** Entry ID = equipmentId. Each row in the dropdown is one device,
     *  so multi-device members appear once per device. */
    id: number
    memberId: number
    firstName: string
    lastName: string
    position: string | null
    displayName: string
    equipmentId: number | null
    /** Human equipment name like "PNL 1" / "WLBP 3" — surfaced in the
     *  dropdown and trigger so admins know what they're switching to. */
    equipmentName: string | null
  }>
  siblingGear?: Array<{
    id: number
    name: string
    category: string
    hardwareType: string | null
  }>
}

type KeyState = {
  keyIndex: number
  page: string
  expansion: number
  pickListItemId: number | null
  pickListItemName: string | null
  pickListItemType: string | null
  triggerMode: string
  talkMode: string
  status: 'empty' | 'assigned' | 'changed' | 'submitted'
}

type PickerItem = {
  id: number
  code: string | null
  name: string
  type: string
  position?: string | null
}

/* ═══════════════════════════════════════════════════════════════
   Hardware key counts
   ═══════════════════════════════════════════════════════════════ */

const HARDWARE_KEY_COUNTS: Record<string, number> = {
  'RSP-1232': 32, 'RSP-1216': 16, 'DSP-1216': 16,
  'KP-5032': 32, 'KP32': 32, 'RSP-2318': 18, 'DSP-2312': 12,
  'DKP-3016': 16, 'KP-3016': 16, 'DSPK4': 4,
  'Helixnet': 4, 'DBP4': 4, 'DBP5': 4, 'ST-374': 4, 'ST370': 2,
  'C3': 2, 'BP325': 2, 'Bolero 1.9': 6, 'Bolero 2.4': 6, 'Freespeak': 4, 'Pliant': 4,
}

/* ─── Block layout per hardware type ───
   colsPerBlock / rowsPerBlock = the grid within each block
   blockCount = how many blocks in the main panel
   For horizontal panels: blocks sit in panel-level rows (panelRows × blocksPerPanelRow)
   For vertical-block panels (2318, 2312, Bolero, DBP): all blocks side by side */
type BlockLayout = {
  colsPerBlock: number
  rowsPerBlock: number
  blockCount: number
  panelRows: number
  blocksPerPanelRow: number
}

const BLOCK_LAYOUTS: Record<string, BlockLayout> = {
  'RSP-1232':  { colsPerBlock: 8, rowsPerBlock: 1, blockCount: 4, panelRows: 2, blocksPerPanelRow: 2 },
  'RSP-1216':  { colsPerBlock: 8, rowsPerBlock: 1, blockCount: 2, panelRows: 1, blocksPerPanelRow: 2 },
  'DSP-1216':  { colsPerBlock: 8, rowsPerBlock: 1, blockCount: 2, panelRows: 1, blocksPerPanelRow: 2 },
  'KP-5032':   { colsPerBlock: 8, rowsPerBlock: 1, blockCount: 4, panelRows: 2, blocksPerPanelRow: 2 },
  'KP32':      { colsPerBlock: 8, rowsPerBlock: 1, blockCount: 4, panelRows: 2, blocksPerPanelRow: 2 },
  'RSP-2318':  { colsPerBlock: 2, rowsPerBlock: 3, blockCount: 3, panelRows: 1, blocksPerPanelRow: 3 },
  'DSP-2312':  { colsPerBlock: 2, rowsPerBlock: 3, blockCount: 2, panelRows: 1, blocksPerPanelRow: 2 },
  // 16 keys laid out as 2 rows x 8 columns (single contiguous block).
  'DKP-3016':  { colsPerBlock: 8, rowsPerBlock: 2, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  // 16 keys laid out as 2 sections of 8 in a single horizontal row.
  'KP-3016':   { colsPerBlock: 8, rowsPerBlock: 1, blockCount: 2, panelRows: 1, blocksPerPanelRow: 2 },
  // 4 keys laid out as 2 rows x 2 columns.
  'DSPK4':     { colsPerBlock: 2, rowsPerBlock: 2, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  'Bolero 1.9': { colsPerBlock: 2, rowsPerBlock: 3, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  'Bolero 2.4': { colsPerBlock: 2, rowsPerBlock: 3, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  'Freespeak': { colsPerBlock: 4, rowsPerBlock: 1, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  'Pliant':    { colsPerBlock: 4, rowsPerBlock: 1, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  'DBP4':      { colsPerBlock: 2, rowsPerBlock: 2, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  'DBP5':      { colsPerBlock: 2, rowsPerBlock: 2, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  'ST-374':    { colsPerBlock: 4, rowsPerBlock: 1, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  'Helixnet':  { colsPerBlock: 4, rowsPerBlock: 1, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  'ST370':     { colsPerBlock: 2, rowsPerBlock: 1, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  'C3':        { colsPerBlock: 2, rowsPerBlock: 1, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
  'BP325':     { colsPerBlock: 2, rowsPerBlock: 1, blockCount: 1, panelRows: 1, blocksPerPanelRow: 1 },
}

const DEFAULT_LAYOUT: BlockLayout = { colsPerBlock: 8, rowsPerBlock: 1, blockCount: 2, panelRows: 1, blocksPerPanelRow: 2 }

function getBlockLayout(hardwareType: string | null): BlockLayout {
  return (hardwareType ? BLOCK_LAYOUTS[hardwareType] : null) ?? DEFAULT_LAYOUT
}

/* ─── Expansion config ─── */
const EXPANSION_LAYOUTS: Record<string, BlockLayout> = {
  'RSP-1232':  { colsPerBlock: 8, rowsPerBlock: 1, blockCount: 2, panelRows: 1, blocksPerPanelRow: 2 },
  'RSP-1216':  { colsPerBlock: 8, rowsPerBlock: 1, blockCount: 2, panelRows: 1, blocksPerPanelRow: 2 },
  'KP-5032':   { colsPerBlock: 8, rowsPerBlock: 1, blockCount: 4, panelRows: 2, blocksPerPanelRow: 2 },
  'KP32':      { colsPerBlock: 8, rowsPerBlock: 1, blockCount: 4, panelRows: 2, blocksPerPanelRow: 2 },
  'RSP-2318':  { colsPerBlock: 2, rowsPerBlock: 3, blockCount: 4, panelRows: 1, blocksPerPanelRow: 4 },
}

function getExpansionLayout(hardwareType: string | null): BlockLayout | null {
  return hardwareType ? (EXPANSION_LAYOUTS[hardwareType] ?? null) : null
}

function getExpansionKeyCount(hardwareType: string | null): number {
  const layout = getExpansionLayout(hardwareType)
  if (!layout) return 0
  return layout.colsPerBlock * layout.rowsPerBlock * layout.blockCount
}

function getKeyCount(hardwareType: string | null): number {
  return hardwareType ? (HARDWARE_KEY_COUNTS[hardwareType] ?? 16) : 16
}

/* ─── Shift page & expansion eligibility ─── */
const SHIFT_PAGE_CATEGORIES = new Set(['panels'])
const EXPANDABLE_DEVICES = new Set(['RSP-1232', 'RSP-1216', 'KP-5032', 'KP32', 'RSP-2318'])

/* ═══════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════ */

export function PanelStudio({
  userName,
  isAdminGlobal,
  isUserOnly,
  equipment,
  member,
  project,
  panelKeys: initialPanelKeys,
  pickListItems,
  ptpMembers,
  currentUserRole: _currentUserRole,
  canEditKeys,
  canManageExpansions,
  showIpAddress,
  isRequestMode,
  currentUserId,
  currentMemberId: _currentMemberId,
  pendingChangeRequests = [],
  pendingSubmittedSlots = [],
  recentResolutions = [],
  browseProjects,
  browseMembers,
  siblingGear,
}: PanelStudioProps) {
  const isCrew = _currentUserRole === 'crew'
  void _currentMemberId
  const router = useRouter()
  const keyCount = getKeyCount(equipment.hardwareType)
  const layout = getBlockLayout(equipment.hardwareType)
  const hasShiftPage = SHIFT_PAGE_CATEGORIES.has(equipment.category)
  const isExpandable = EXPANDABLE_DEVICES.has(equipment.hardwareType ?? '')
  // expKeyCount must be hoisted above the useState that calls
  // initializeKeys — otherwise the lazy initializer hits the const in
  // its temporal dead zone and crashes with "Cannot access … before
  // initialization" on first render.
  const expKeyCount = getExpansionKeyCount(equipment.hardwareType)

  /* ─── State ─── */
  const [activePage, setActivePage] = useState<'main' | 'shift'>('main')
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  // Bottom-sheet snap state (mobile only). Three positions:
  //   full — picker takes the whole comfortable height (default open)
  //   half — picker covers ~50% of the viewport so the chassis above
  //          stays visible; chips can still be dragged onto keys
  //   peek — just the header + drag handle, leaves the chassis open
  // Resets to 'full' whenever the picker re-opens so each interaction
  // starts the same way regardless of the previous user's last drag.
  const [pickerSnap, setPickerSnap] = useState<'peek' | 'half' | 'full'>('full')
  // Live drag-offset in pixels while the user has the handle held.
  // null when not dragging — the snap position drives the height.
  const [dragOffsetY, setDragOffsetY] = useState<number | null>(null)
  // Remembers the snap state we collapsed FROM when a chip-drag
  // begins, so on drop we can restore the user's previous size
  // instead of always opening at full.
  const preChipDragSnapRef = useRef<'peek' | 'half' | 'full' | null>(null)
  // Tracks whether a key→key drag temporarily hid the bottom-sheet
  // inspector on mobile. Restored on drop/cancel so the user lands
  // back where they were (picker open if it was open before the drag).
  const keyDragHidInspectorRef = useRef<boolean>(false)
  // Ref to the mobile picker list scroll container so we can preserve
  // its scrollTop across a chip drag. When the sheet collapses to
  // 'peek' during the drag, the visible area shrinks below the
  // current scroll offset and the browser clamps scrollTop back to 0
  // — so when the sheet re-expands on drop, the user is at the top
  // of the list instead of where they were. We snapshot scrollTop on
  // drag start and restore it on drop / cancel.
  const mobilePickerScrollRef = useRef<HTMLDivElement | null>(null)
  const preChipDragScrollTopRef = useRef<number | null>(null)
  // `mounted` flag so the inline-style height (which depends on
  // window.innerHeight / innerWidth) is only emitted on the client.
  // Server-side render skips the style and the first client render
  // matches it — no hydration mismatch. After mount we apply the
  // real style and React patches it in.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  // Reset to full whenever the inspector reopens so each new pick
  // session starts from a known state.
  useEffect(() => {
    if (inspectorOpen) setPickerSnap('full')
  }, [inspectorOpen])

  // Resolve a snap position to a pixel height. Mobile only — desktop
  // ignores these and uses the absolute-positioned panel layout.
  function snapHeightPx(snap: 'peek' | 'half' | 'full'): number {
    if (typeof window === 'undefined') return 480
    const vh = window.innerHeight
    if (snap === 'peek') return 180
    if (snap === 'half') return Math.round(vh * 0.5)
    return Math.round(vh * 0.75) // full
  }

  // Bind the drag handle pill at the top of the bottom sheet. Drag
  // up grows the sheet; drag down shrinks it. On release we snap to
  // the closest of the three positions, accounting for swipe
  // velocity so a fast flick down dismisses past the nearest snap
  // point and lands on the next one.
  const sheetDragBind = useDrag(({ down, movement: [, my], velocity: [, vy], direction: [, dy] }) => {
    if (down) {
      // Live update during the drag — height = base - my (because
      // dragging UP means my is negative and height should grow).
      setDragOffsetY(my)
      return
    }
    // Drag released — figure out target snap (or dismiss).
    const base = snapHeightPx(pickerSnap)
    const liveHeight = base - my
    const order: Array<'peek' | 'half' | 'full'> = ['peek', 'half', 'full']
    const heights = order.map(snapHeightPx)
    let nextSnap: 'peek' | 'half' | 'full' = pickerSnap

    // Dismissal: dragging past peek (or fast-flicking down from peek)
    // closes the picker entirely. Lets users fully clear the sheet
    // off-screen with a single gesture, instead of being stuck at a
    // 180px peek they still can't see past.
    const peekHeight = snapHeightPx('peek')
    if (
      liveHeight < peekHeight - 30 ||
      (pickerSnap === 'peek' && vy > 0.5 && dy > 0)
    ) {
      setDragOffsetY(null)
      closeInspector()
      return
    }

    // Velocity-driven jump for flicks. dy is the sign of recent
    // movement (-1 up, +1 down). vy is magnitude.
    if (vy > 0.5 && dy > 0) {
      // Fast flick down — go one snap smaller.
      const idx = order.indexOf(pickerSnap)
      nextSnap = order[Math.max(0, idx - 1)]
    } else if (vy > 0.5 && dy < 0) {
      // Fast flick up — go one snap larger.
      const idx = order.indexOf(pickerSnap)
      nextSnap = order[Math.min(2, idx + 1)]
    } else {
      // Otherwise snap to nearest height.
      let bestI = 0
      let bestD = Infinity
      heights.forEach((h, i) => {
        const d = Math.abs(h - liveHeight)
        if (d < bestD) {
          bestD = d
          bestI = i
        }
      })
      nextSnap = order[bestI]
    }
    setPickerSnap(nextSnap)
    setDragOffsetY(null)
  }, {
    // Filter out tiny moves so taps on the handle don't register
    // as a drag (and start fighting clicks on nearby buttons).
    filterTaps: true,
    axis: 'y',
  })
  // Persist the picker card's open/closed state across panel navigations
  // (e.g. when the user uses the BrowseMemberSwitcher to jump between
  // equipment) so an admin who opened the picker on one user keeps it
  // open on the next, instead of having to re-open it every time. Uses
  // sessionStorage so the preference resets per browser session. We
  // initialise to `false` and sync from storage in an effect to avoid
  // a hydration mismatch between server (no window) and client.
  const PICKER_OPEN_STORAGE_KEY = 'panelStudio:pickerOpen'
  const [pickerMode, setPickerMode] = useState(false)
  // Read the stored value once on mount.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(PICKER_OPEN_STORAGE_KEY) === '1') setPickerMode(true)
    } catch {}
  }, [])
  // Write back whenever it changes.
  useEffect(() => {
    try { window.sessionStorage.setItem(PICKER_OPEN_STORAGE_KEY, pickerMode ? '1' : '0') }
    catch {}
  }, [pickerMode])
  // Overlay pending-submission state on top of the freshly-initialized
  // keys. ChangeRequestItems that are still unresolved (status submitted /
  // mgr_endorsed) carry the values the user REQUESTED — the underlying
  // PanelKey row still holds the previous (unapproved) value. So when the
  // user navigates away and back, we hydrate the green-bordered "submitted"
  // state from those items rather than relying on in-memory state.
  function applyPendingSubmittedSlots(seed: KeyState[]): KeyState[] {
    if (pendingSubmittedSlots.length === 0) return seed
    const pendingMap = new Map(
      pendingSubmittedSlots.map((p) => [
        `${p.expansion}-${p.page}-${p.keyIndex}`,
        p,
      ])
    )
    return seed.map((k) => {
      const id = `${k.expansion}-${k.page}-${k.keyIndex}`
      const pending = pendingMap.get(id)
      if (!pending) return k
      // Resolve pick-list metadata from the prop list so the chip renders
      // the requested name (not the previously-applied name).
      const pickItem = pending.pickListItemId != null
        ? pickListItems.find((p) => p.id === pending.pickListItemId) ?? null
        : null
      return {
        ...k,
        pickListItemId: pickItem ? pickItem.id : null,
        pickListItemName: pickItem ? pickItem.name : null,
        pickListItemType: pickItem ? pickItem.type : null,
        triggerMode: pending.triggerMode ?? k.triggerMode,
        talkMode: pending.talkMode ?? k.talkMode,
        status: 'submitted',
      }
    })
  }
  const [keys, setKeys] = useState<KeyState[]>(() =>
    applyPendingSubmittedSlots(initializeKeys(initialPanelKeys, keyCount))
  )
  const [clipboard, setClipboard] = useState<{ pickListItemId: number | null; pickListItemName: string | null; pickListItemType: string | null; triggerMode: string; talkMode: string } | null>(null)
  const [flashingKey, setFlashingKey] = useState<{ id: string; color: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  // Mobile-only: the picker search input is hidden behind a chip-
  // style search-icon button to save vertical space. Tapping the
  // icon expands a row with the input + an X to collapse it back.
  const [mobilePickerSearchOpen, setMobilePickerSearchOpen] = useState(false)
  const [pickerFilter, setPickerFilter] = useState<string>('All')
  // Active drag source — driven by dnd-kit's onDragStart so the chassis can
  // dim the source key during a key→key swap. Drop-target highlights come
  // from dnd-kit's per-tile `isOver`, so we don't track them here.
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [expansionCount, setExpansionCount] = useState(() => {
    const maxExp = initialPanelKeys.reduce((max, k) => Math.max(max, k.expansion), 0)
    return maxExp
  })

  // Panel-level clipboard for the Copy / Paste buttons next to Save.
  // Holds every key (across main, shift, and all expansions) from the source
  // panel and persists across navigation via sessionStorage so admins can
  // copy from one user and paste onto another. Distinct from the per-key
  // `clipboard` above which only holds a single key.
  type PanelClipboardEntry = {
    keyIndex: number
    page: string
    expansion: number
    pickListItemId: number | null
    pickListItemName: string | null
    pickListItemType: string | null
    triggerMode: string
    talkMode: string
  }
  type PanelClipboard = {
    sourceLabel: string
    entries: PanelClipboardEntry[]
    // Unix ms when the panel was last copied. Used by the long-press
    // preview to show "Copied N minutes ago".
    createdAt?: number
  }
  const [panelClipboard, setPanelClipboard] = useState<PanelClipboard | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = sessionStorage.getItem('panel-clipboard')
      if (raw) setPanelClipboard(JSON.parse(raw) as PanelClipboard)
    } catch {
      // sessionStorage unavailable or corrupt — ignore.
    }
  }, [])

  // Fingerprint the server data to detect real changes (not just reference
  // changes). Includes recentResolution IDs so a denial (which doesn't
  // modify PanelKey data) still triggers a sync — otherwise the crew's
  // local "submitted" state would persist and look like a phantom approval.
  const serverFingerprint = useMemo(
    () => {
      const keysFp = initialPanelKeys
        .map((k) => `${k.keyIndex}:${k.page}:${k.expansion}:${k.pickListItemId}`)
        .join('|')
      const resFp = recentResolutions.map((r) => r.id).sort((a, b) => a - b).join(',')
      // Pending-submission slots also live in the fingerprint so a new
      // submission (e.g. submitted from another tab) re-runs the sync
      // effect and the green border appears here too.
      const pendingFp = pendingSubmittedSlots
        .map((p) => `${p.expansion}:${p.page}:${p.keyIndex}:${p.pickListItemId}`)
        .sort()
        .join('|')
      return `${keysFp}||res:${resFp}||pend:${pendingFp}`
    },
    [initialPanelKeys, recentResolutions, pendingSubmittedSlots]
  )
  const prevFingerprintRef = useRef(serverFingerprint)
  const hasSubmittedKeysRef = useRef(false)
  // Resolutions we've already processed — prevents a toast from firing
  // twice for the same resolution on repeated polls.
  const seenResolutionIdsRef = useRef<Set<number>>(new Set())

  // Track whether we have submitted keys
  const hasSubmittedKeys = keys.some((k) => k.status === 'submitted')
  useEffect(() => {
    hasSubmittedKeysRef.current = hasSubmittedKeys
  }, [hasSubmittedKeys])

  // Sync keys from server when data actually changes (admin approved / denied
  // a request, someone else edited, etc.) and surface an approve/deny toast
  // matching what the admin did to any of our submitted keys.
  useEffect(() => {
    if (prevFingerprintRef.current === serverFingerprint) return
    prevFingerprintRef.current = serverFingerprint

    // Collect ids of keys whose pending request just resolved
    // (admin approve / deny). Those keys should re-initialize from
    // the fresh server state — losing their local 'submitted'
    // status — because the source-of-truth (PanelKey) was updated.
    const resolvedKeyIds = new Set<string>()
    const newResolutionsForReset = recentResolutions.filter(
      (r) => !seenResolutionIdsRef.current.has(r.id),
    )
    for (const res of newResolutionsForReset) {
      for (const item of res.items) {
        resolvedKeyIds.add(keyId(item.keyIndex, item.page, item.expansion))
      }
    }

    // Re-init from the fresh server snapshot, but PRESERVE keys the
    // user has locally marked as 'submitted' or 'changed' — UNLESS
    // their request just resolved. Otherwise saveDraftKeys' upsert
    // (which creates PanelKey rows for any newly-touched key with
    // pickListItemId=null) bumps the fingerprint and this effect
    // would clobber the user's pending submission back to 'empty',
    // making the key visually disappear.
    setKeys((prev) => {
      // Start from server PanelKey snapshot, then re-apply pending
      // submissions so anything still awaiting admin review keeps its
      // green border across server-driven syncs.
      const next = applyPendingSubmittedSlots(
        initializeKeys(initialPanelKeys, keyCount)
      )
      const prevById = new Map(prev.map((k) => [keyId(k.keyIndex, k.page, k.expansion), k]))
      return next.map((k) => {
        const id = keyId(k.keyIndex, k.page, k.expansion)
        if (resolvedKeyIds.has(id)) return k
        const existing = prevById.get(id)
        if (existing && (existing.status === 'submitted' || existing.status === 'changed')) {
          return existing
        }
        return k
      })
    })

    // New resolutions since the last sync — decide toast(s).
    const newResolutions = newResolutionsForReset
    if (newResolutions.length > 0) {
      const approvedKeyNums: number[] = []
      const deniedKeyNums: number[] = []
      for (const res of newResolutions) {
        for (const item of res.items) {
          // Display as 1-based key numbers to match the panel's labels.
          const label = item.keyIndex + 1
          if (item.approved) approvedKeyNums.push(label)
          else deniedKeyNums.push(label)
        }
        seenResolutionIdsRef.current.add(res.id)
      }
      if (approvedKeyNums.length > 0) {
        showToast('success', 'Your panel changes are live')
      }
      if (deniedKeyNums.length > 0) {
        const uniq = Array.from(new Set(deniedKeyNums)).sort((a, b) => a - b)
        showToast('error', `Keys ${uniq.join(', ')} denied`)
      }
    } else if (hasSubmittedKeysRef.current) {
      // Fallback: fingerprint changed from a source we can't attribute
      // (e.g. admin edited directly outside the request flow). Keep the
      // existing success toast so the crew knows something updated.
      showToast('success', 'Your panel changes are live')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFingerprint])

  // Poll for updates when there are submitted keys awaiting approval
  useEffect(() => {
    if (!hasSubmittedKeys) return
    const interval = setInterval(() => {
      router.refresh()
    }, 5000)
    return () => clearInterval(interval)
  }, [hasSubmittedKeys, router])

  const isReviewMode = pendingChangeRequests.length > 0
  // Browse mode flag — true when we received the browse data props from the
  // server (admin/manager arriving via /my-equipment).
  const isBrowseMode = !!browseProjects && !!browseMembers
  // Crew / user mode: arrived via /my-equipment, gets a project dropdown
  // in the header (in place of the Back button) but no member switcher.
  const hasProjectOnlySwitcher = !!browseProjects && !browseMembers

  // Remember the last project + member the admin browsed to so the nav
  // "My Equipment" link returns them right where they left off. Cookies are
  // server-readable, so /my-equipment can read them on next entry without a
  // round-trip through the URL.
  useEffect(() => {
    if (!isBrowseMode && !hasProjectOnlySwitcher) return
    const maxAge = 60 * 60 * 24 * 30 // 30 days
    document.cookie = `lastBrowseProject=${project.id};path=/;max-age=${maxAge}`
    if (isBrowseMode && member) {
      document.cookie = `lastBrowseMember=${member.id};path=/;max-age=${maxAge}`
    }
    // Also write the shared `selectedProject` cookie so Dashboard / Tasks /
    // Admin land on the same project the user was just browsing here.
    document.cookie = `selectedProject=${project.id};path=/;max-age=${60 * 60 * 24 * 365}`
    document.cookie = `selectedProjectName=${encodeURIComponent(project.name)};path=/;max-age=${60 * 60 * 24 * 365}`
  }, [isBrowseMode, hasProjectOnlySwitcher, project.id, project.name, member])

  const [reviewProcessing, setReviewProcessing] = useState(false)
  const [rejectedKeyIds, setRejectedKeyIds] = useState<Set<string>>(new Set())

  // Build a map of key positions → requested changes for overlay rendering
  const reviewChangesMap = new Map<string, {
    crId: number
    itemId: number
    fromName: string | null
    toName: string | null
    submitterName: string
    submitterRole: string
    status: string
  }>()
  for (const cr of pendingChangeRequests) {
    for (const item of cr.items) {
      const id = keyId(item.keyIndex, item.page, item.expansion)
      reviewChangesMap.set(id, {
        crId: cr.id,
        itemId: item.id,
        fromName: item.previousValueName,
        toName: item.newValueName,
        submitterName: cr.submitterName,
        submitterRole: cr.submitterRole,
        status: cr.status,
      })
    }
  }

  // Collect unique CR ids for resolve
  const pendingCrIds = [...new Set(pendingChangeRequests.map((cr) => cr.id))]

  // Toggle a review key between approved (yellow) and rejected (red)
  function toggleRejectKey(keyIdStr: string) {
    setRejectedKeyIds((prev) => {
      const next = new Set(prev)
      if (next.has(keyIdStr)) {
        next.delete(keyIdStr)
      } else {
        next.add(keyIdStr)
      }
      return next
    })
  }

  // Count approved vs rejected
  const totalReviewKeys = reviewChangesMap.size
  const rejectedCount = rejectedKeyIds.size
  const approvedCount = totalReviewKeys - rejectedCount

  const inspectorRef = useRef<HTMLElement>(null)
  const chassisRef = useRef<HTMLDivElement>(null)
  // Outer scroller around the chassis — used by the chip-drag auto-
  // scroll effect below to nudge the chassis up/down when the user's
  // finger is near the top/bottom edge during a chip drag. The
  // existing `chassisRef` points at the inner content div, which
  // doesn't carry the overflow.
  const chassisScrollerRef = useRef<HTMLDivElement>(null)

  // Measures the chassis width so the header layout can switch:
  // wide chassis → identity left / legend+buttons right on a single
  // row (justify-between). Narrow chassis (e.g. a 2- or 4-key panel)
  // → stack the two groups into their own centered rows so the
  // header doesn't run wider than the chassis below it.
  const [chassisWidth, setChassisWidth] = useState<number | null>(null)
  // useLayoutEffect (not useEffect) so the initial width measurement
  // happens BEFORE the browser commits the first paint. Without this,
  // the header rendered with chassisWidth=null for one frame, then the
  // useEffect would fire, the chassisWidth state would update, and the
  // header would visibly snap from one layout to the other — the
  // "starts wide then settles" flash the user reported when navigating
  // between panels (especially panel → bolero).
  useLayoutEffect(() => {
    const el = chassisRef.current
    if (!el) return
    // Synchronous initial measurement so the first commit already has
    // the correct chassisWidth and stackHeader is computed correctly
    // for frame 1.
    const initial = el.getBoundingClientRect().width
    if (initial > 0) setChassisWidth(Math.round(initial))
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setChassisWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Threshold below which the header stacks into two centered rows.
  // 720px lines up with roughly the smallest chassis that still fits
  // the full identity strip (ID · name · meta · IP · project ·
  // hardware · key count) on one line.
  //
  // While chassisWidth is still null (first paint, before the
  // ResizeObserver fires), default to `true` so the header lays out
  // in its narrow / centered form. That way navigating from a wide
  // chassis (panel) to a narrow one (bolero, beltpack) doesn't flash
  // the wide layout for one frame before snapping into the centered
  // mode — the user reported that as "sloppy". Wide chassis still
  // expand on the next paint after measurement.
  const stackHeader = chassisWidth === null ? true : chassisWidth < 720

  /* ─── Initialize keys from server data ─── */
  // (expKeyCount is declared above the useState block — it's referenced
  // by initializeKeys' lazy initializer.)

  function initializeKeys(
    serverKeys: PanelStudioProps['panelKeys'],
    mainKeys: number
  ): KeyState[] {
    const result: KeyState[] = []
    const maxExpansion = serverKeys.reduce((max, k) => Math.max(max, k.expansion), 0)

    const pages = hasShiftPage ? ['main', 'shift'] as const : ['main'] as const
    for (let exp = 0; exp <= maxExpansion; exp++) {
      const count = exp === 0 ? mainKeys : expKeyCount
      for (const page of pages) {
        for (let i = 0; i < count; i++) {
          const serverKey = serverKeys.find(
            (k) => k.keyIndex === i && k.page === page && k.expansion === exp
          )
          result.push({
            keyIndex: i,
            page,
            expansion: exp,
            pickListItemId: serverKey?.pickListItemId ?? null,
            pickListItemName: serverKey?.pickListItemName ?? null,
            pickListItemType: serverKey?.pickListItemType ?? null,
            triggerMode: serverKey?.triggerMode ?? 'latch',
            talkMode: serverKey?.talkMode ?? 'tl',
            status: serverKey?.pickListItemId ? 'assigned' : 'empty',
          })
        }
      }
    }
    return result
  }

  /* ─── Unique key ID ─── */
  function keyId(keyIndex: number, page: string, expansion: number): string {
    return `${expansion}-${page}-${keyIndex}`
  }

  function parseKeyId(id: string): { expansion: number; page: string; keyIndex: number } {
    const [exp, page, idx] = id.split('-')
    return { expansion: parseInt(exp), page, keyIndex: parseInt(idx) }
  }

  /* ─── Key getters/setters ─── */
  function getKey(id: string): KeyState | undefined {
    const { expansion, page, keyIndex } = parseKeyId(id)
    return keys.find((k) => k.keyIndex === keyIndex && k.page === page && k.expansion === expansion)
  }

  function updateKey(id: string, updates: Partial<KeyState>) {
    const { expansion, page, keyIndex } = parseKeyId(id)
    setKeys((prev) =>
      prev.map((k) =>
        k.keyIndex === keyIndex && k.page === page && k.expansion === expansion
          ? { ...k, ...updates }
          : k
      )
    )
  }

  /* ─── Flash feedback ─── */
  function flashKey(id: string, color: string) {
    setFlashingKey({ id, color })
    setTimeout(() => setFlashingKey(null), 300)
  }

  /* ─── Key selection ─── */
  function selectKey(id: string) {
    const key = getKey(id)
    if (!key) return
    // Toggle: tapping the already-selected key closes the picker (or
    // detail view) — a single key click should be able to dismiss the
    // UI it just opened, not just reopen it.
    if (selectedKeyId === id && (pickerMode || inspectorOpen)) {
      closeInspector()
      return
    }
    setSelectedKeyId(id)
    // canEditKeys: jump straight into picker mode so the picker card
    // (desktop) or picker view inside the inspector (mobile) is what
    // the user sees first — no intermediate "key details" step.
    // Read-only viewers still get the detail view since they have
    // nothing to pick.
    setInspectorOpen(true)
    setPickerMode(canEditKeys)
  }

  function deselectAll() {
    setSelectedKeyId(null)
  }

  /* ─── Inspector ─── */
  function closeInspector() {
    setInspectorOpen(false)
    setPickerMode(false)
    // Drop the key selection too — leaving it highlighted in cyan after the
    // inspector is dismissed is misleading because there's no longer any UI
    // tied to that selection.
    setSelectedKeyId(null)
  }

  /* ─── Get visible keys for current page ─── */
  function getVisibleKeys(page: string, expansion: number): KeyState[] {
    return keys
      .filter((k) => k.page === page && k.expansion === expansion)
      .sort((a, b) => a.keyIndex - b.keyIndex)
  }

  /* ─── Get changed keys count ─── */
  const changedKeysCount = keys.filter((k) => k.status === 'changed').length

  /* ─── Soft presence ───
   * Heartbeat to /api/panel-presence so anyone else viewing this same
   * equipment sees us in the top strip, and we see them. State flips
   * to 'editing' whenever there are unsaved changes — gives the other
   * viewer a stronger signal that we're actively touching the panel.
   */
  const presenceViewers = usePanelPresence(
    equipment?.id ?? null,
    changedKeysCount > 0,
  )

  /* ─── Key actions ─── */
  function clearKey(id: string) {
    if (!canEditKeys) return
    const key = getKey(id)
    if (!key || key.status === 'empty') return
    updateKey(id, {
      pickListItemId: null,
      pickListItemName: null,
      pickListItemType: null,
      triggerMode: 'latch',
      talkMode: 'tl',
      status: isRequestMode ? 'changed' : 'empty',
    })
    flashKey(id, '#ef4444')
  }

  function copyKey(id: string) {
    const key = getKey(id)
    if (!key || key.status === 'empty') return
    setClipboard({
      pickListItemId: key.pickListItemId,
      pickListItemName: key.pickListItemName,
      pickListItemType: key.pickListItemType,
      triggerMode: key.triggerMode,
      talkMode: key.talkMode,
    })
    flashKey(id, '#22a7d3')
  }

  function cutKey(id: string) {
    if (!canEditKeys) return
    const key = getKey(id)
    if (!key || key.status === 'empty') return
    setClipboard({
      pickListItemId: key.pickListItemId,
      pickListItemName: key.pickListItemName,
      pickListItemType: key.pickListItemType,
      triggerMode: key.triggerMode,
      talkMode: key.talkMode,
    })
    updateKey(id, {
      pickListItemId: null,
      pickListItemName: null,
      pickListItemType: null,
      triggerMode: 'latch',
      talkMode: 'tl',
      status: isRequestMode ? 'changed' : 'empty',
    })
    flashKey(id, '#f59e0b')
  }

  function pasteKey(id: string) {
    if (!canEditKeys || !clipboard) return
    updateKey(id, {
      ...clipboard,
      status: isRequestMode ? 'changed' : 'assigned',
    })
    flashKey(id, '#10b981')
  }

  function assignPickerItem(id: string, item: PickerItem) {
    if (!canEditKeys) return
    updateKey(id, {
      pickListItemId: item.id,
      pickListItemName: item.name,
      pickListItemType: item.type,
      // Pick-list assignments default to 'momentary' — most show comms
      // talkback flows are momentary (push-to-talk style), so this saves
      // an extra tap for the common case. Admins can flip to latch in
      // the inspector after assignment. Talk default 'tl' (Talk +
      // Listen) which matches the typical PTP behavior.
      triggerMode: 'momentary',
      talkMode: 'tl',
      status: isRequestMode ? 'changed' : 'assigned',
    })
    // Stay in picker mode after assigning so the user can keep
    // tapping chips to fill more keys without the picker collapsing
    // back to the old detail-view modal. To exit, click the X on the
    // card or tap the same key again. Drop-to-assign in handleDndEnd
    // already follows this same "stay open" pattern.
    flashKey(id, '#10b981')
  }

  function setTriggerMode(id: string, mode: string) {
    if (!canEditKeys) return
    const key = getKey(id)
    if (!key) return
    updateKey(id, {
      triggerMode: mode,
      status: key.status === 'empty' ? 'empty' : (isRequestMode ? 'changed' : key.status),
    })
  }

  function setTalkMode(id: string, mode: string) {
    if (!canEditKeys) return
    const key = getKey(id)
    if (!key) return
    updateKey(id, {
      talkMode: mode,
      status: key.status === 'empty' ? 'empty' : (isRequestMode ? 'changed' : key.status),
    })
  }

  /* ─── Keyboard shortcuts ─── */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return

      if (e.key === 'Escape') {
        // Collapse everything in one shot — picker mode, inspector,
        // AND the key highlight — so we never fall back to the old
        // detail-view "ghost modal" mid-press. closeInspector() does
        // all three: setInspectorOpen(false), setPickerMode(false),
        // setSelectedKeyId(null). If nothing was open, this is a
        // no-op apart from clearing the highlight.
        closeInspector()
        return
      }

      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedKeyId) {
        e.preventDefault()
        clearKey(selectedKeyId)
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectedKeyId) {
        e.preventDefault()
        copyKey(selectedKeyId)
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'x' && selectedKeyId) {
        e.preventDefault()
        cutKey(selectedKeyId)
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && selectedKeyId && clipboard) {
        e.preventDefault()
        pasteKey(selectedKeyId)
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeyId, clipboard, pickerMode, inspectorOpen, canEditKeys, isRequestMode])

  /* ─── Panel-level Copy / Paste (admin/manager) ─── */
  function handleCopyPanel() {
    const memberName = member ? `${member.firstName} ${member.lastName}`.trim() : ''
    const sourceLabel = [equipment.name, memberName].filter(Boolean).join(' · ') || 'Panel'
    const entries: PanelClipboardEntry[] = keys.map((k) => ({
      keyIndex: k.keyIndex,
      page: k.page,
      expansion: k.expansion,
      pickListItemId: k.pickListItemId,
      pickListItemName: k.pickListItemName,
      pickListItemType: k.pickListItemType,
      triggerMode: k.triggerMode,
      talkMode: k.talkMode,
    }))
    const payload: PanelClipboard = { sourceLabel, entries, createdAt: Date.now() }
    setPanelClipboard(payload)
    try {
      sessionStorage.setItem('panel-clipboard', JSON.stringify(payload))
    } catch {
      // ignore
    }
    // Also drop the plain-text snapshot onto the system clipboard so the
    // admin can paste it into Slack / a sheet if they want a paper trail.
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      const text = formatKeysForClipboard(equipment, member, keys)
      void navigator.clipboard.writeText(text).catch(() => {})
    }
    showToast('success', `Copied ${entries.length} keys`)
  }

  // Long-press on the Paste button opens this preview before paste
  // commits. Quick taps still paste immediately (existing behaviour).
  // Preview shows source label, copied-at age, and the first few keys
  // so the user can see what's about to overwrite this panel.
  const [pastePreviewOpen, setPastePreviewOpen] = useState(false)
  // Long-press plumbing — refs so the timer + fired flag persist
  // across renders and across both Paste buttons (desktop + mobile).
  // Only one is visible at a time based on breakpoint, so sharing
  // refs is safe.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)
  function startLongPress() {
    longPressFiredRef.current = false
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true
      // Preview renders inline on the chassis — no inspector / sheet
      // toggle needed. Just flip the state.
      setPastePreviewOpen(true)
    }, 500)
  }
  function cancelLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }
  // Click handler used by both Paste buttons. Tap behavior:
  //   • Preview is OFF → commits the paste immediately.
  //   • Preview is ON  → cancels the preview (does NOT paste).
  // The next tap (with preview now off) will paste. Long-press still
  // opens the preview from the off state.
  // Long-press synthesizes a click on pointerup; swallow that so the
  // long-press doesn't fall through to either branch.
  function handlePasteClick() {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false
      return
    }
    if (pastePreviewOpen) {
      setPastePreviewOpen(false)
      return
    }
    handlePastePanel()
  }


  function handlePastePanel() {
    if (!panelClipboard) return
    // Always close the preview when the paste commits, so a tap on
    // the header Paste button while the preview is up applies the
    // paste AND restores whatever was on screen before (picker or
    // chassis only).
    setPastePreviewOpen(false)
    let pasted = 0
    for (const entry of panelClipboard.entries) {
      const target = keys.find(
        (k) => k.keyIndex === entry.keyIndex && k.page === entry.page && k.expansion === entry.expansion,
      )
      if (!target) continue
      const id = keyId(entry.keyIndex, entry.page, entry.expansion)
      const hasItem = entry.pickListItemId != null
      updateKey(id, {
        pickListItemId: entry.pickListItemId,
        pickListItemName: entry.pickListItemName,
        pickListItemType: entry.pickListItemType,
        triggerMode: entry.triggerMode,
        talkMode: entry.talkMode ?? 'tl',
        status: isRequestMode ? 'changed' : (hasItem ? 'assigned' : 'empty'),
      })
      pasted++
    }
    if (pasted > 0) {
      showToast('success', `Pasted ${pasted} keys from ${panelClipboard.sourceLabel}`)
    } else {
      showToast('error', 'No matching keys to paste')
    }
  }

  /* ─── Save handler ─── */
  async function handleSave() {
    if (!member) return
    setSaving(true)

    const changedKeys = keys
      .filter((k) => k.status === 'changed' || k.status === 'assigned')
      .map((k) => ({
        keyIndex: k.keyIndex,
        page: k.page,
        expansion: k.expansion,
        pickListItemId: k.pickListItemId,
        triggerMode: k.triggerMode,
        talkMode: k.talkMode,
      }))

    try {
      if (isRequestMode) {
        const result = await saveDraftKeys(member.id, equipment.id, currentUserId, changedKeys)
        if (result.error) {
          showToast('error', result.error)
        } else {
          showToast('success', 'Draft saved')
        }
      } else {
        const result = await saveKeys(member.id, equipment.id, changedKeys)
        if (result.error) {
          showToast('error', result.error)
        } else {
          showToast('success', 'Keys saved')
          // Mark all changed as assigned
          setKeys((prev) =>
            prev.map((k) =>
              k.status === 'changed'
                ? { ...k, status: k.pickListItemId ? 'assigned' : 'empty' }
                : k
            )
          )
        }
      }
    } catch {
      showToast('error', 'Save failed')
    }
    setSaving(false)
  }

  /* ─── Submit changes handler ─── */
  async function handleSubmit() {
    if (!member) return
    setSaving(true)
    try {
      // First save drafts
      const changedKeys = keys
        .filter((k) => k.status === 'changed')
        .map((k) => ({
          keyIndex: k.keyIndex,
          page: k.page,
          expansion: k.expansion,
          pickListItemId: k.pickListItemId,
          triggerMode: k.triggerMode,
          talkMode: k.talkMode,
        }))

      if (changedKeys.length === 0) {
        showToast('error', 'No changes to submit')
        setSaving(false)
        return
      }

      const draftResult = await saveDraftKeys(member.id, equipment.id, currentUserId, changedKeys)
      if (draftResult.error) {
        showToast('error', draftResult.error)
        setSaving(false)
        return
      }

      const result = await submitChanges(member.id, equipment.id, project.id, currentUserId)
      if (result.error) {
        showToast('error', result.error)
      } else {
        showToast('success', 'Changes submitted for approval')
        // Mark changed keys as submitted
        setKeys((prev) =>
          prev.map((k) => (k.status === 'changed' ? { ...k, status: 'submitted' } : k))
        )
        // Dismiss the picker card / inspector so the user immediately
        // sees the chassis with the green-bordered submitted keys.
        // Same call that the close-X button uses: clears picker mode,
        // inspector open state, and the highlighted key id.
        closeInspector()
      }
    } catch {
      showToast('error', 'Submit failed')
    }
    setSaving(false)
  }

  /* ─── Review handlers ─── */
  const [, startReviewTransition] = useTransition()

  function handleResolve() {
    setReviewProcessing(true)
    startReviewTransition(async () => {
      try {
        // Split items into approved and denied based on rejected keys
        const approvedItemIds: number[] = []
        const deniedItemIds: number[] = []
        for (const [kId, change] of reviewChangesMap) {
          if (rejectedKeyIds.has(kId)) {
            deniedItemIds.push(change.itemId)
          } else {
            approvedItemIds.push(change.itemId)
          }
        }

        const result = await resolveChangeRequests(pendingCrIds, approvedItemIds, deniedItemIds)
        if (result.error) {
          showToast('error', result.error)
          setReviewProcessing(false)
          return
        }

        if (deniedItemIds.length === 0) {
          showToast('success', `${approvedItemIds.length} key${approvedItemIds.length !== 1 ? 's' : ''} approved`)
        } else if (approvedItemIds.length === 0) {
          showToast('success', `${deniedItemIds.length} key${deniedItemIds.length !== 1 ? 's' : ''} denied`)
        } else {
          showToast('success', `${approvedItemIds.length} approved, ${deniedItemIds.length} denied`)
        }
        router.replace('/admin')
      } catch {
        showToast('error', 'Failed to resolve')
      }
      setReviewProcessing(false)
    })
  }

  function handleDenyAll() {
    // Mark all keys as rejected then resolve
    const allKeys = new Set<string>()
    for (const kId of reviewChangesMap.keys()) {
      allKeys.add(kId)
    }
    setRejectedKeyIds(allKeys)

    setReviewProcessing(true)
    startReviewTransition(async () => {
      try {
        const allItemIds = [...reviewChangesMap.values()].map((c) => c.itemId)
        const result = await resolveChangeRequests(pendingCrIds, [], allItemIds)
        if (result.error) {
          showToast('error', result.error)
          setReviewProcessing(false)
          return
        }
        showToast('success', `${allItemIds.length} key${allItemIds.length !== 1 ? 's' : ''} denied`)
        router.replace('/admin')
      } catch {
        showToast('error', 'Failed to deny')
      }
      setReviewProcessing(false)
    })
  }

  /* ─── Expansion handlers ─── */
  async function handleAddExpansion() {
    if (!member || !equipment.hardwareType) return
    setSaving(true)
    try {
      const result = await addExpansion(member.id, equipment.id, equipment.hardwareType)
      if (result.error) {
        showToast('error', result.error)
      } else {
        const newExp = result.expansion!
        setExpansionCount(newExp)
        // Add empty keys for the new expansion
        const newKeys: KeyState[] = []
        const expPages = hasShiftPage ? ['main', 'shift'] as const : ['main'] as const
        for (const page of expPages) {
          for (let i = 0; i < expKeyCount; i++) {
            newKeys.push({
              keyIndex: i,
              page,
              expansion: newExp,
              pickListItemId: null,
              pickListItemName: null,
              pickListItemType: null,
              triggerMode: 'latch',
              talkMode: 'tl',
              status: 'empty',
            })
          }
        }
        setKeys((prev) => [...prev, ...newKeys])
        showToast('success', 'Expansion added')
      }
    } catch {
      showToast('error', 'Failed to add expansion')
    }
    setSaving(false)
  }

  async function handleRemoveExpansion() {
    if (!member || expansionCount <= 0) return
    setSaving(true)
    try {
      const result = await removeExpansion(member.id, equipment.id, expansionCount)
      if (result.error) {
        showToast('error', result.error)
      } else {
        // Remove keys for the removed expansion
        setKeys((prev) => prev.filter((k) => k.expansion !== expansionCount))
        setExpansionCount((prev) => prev - 1)
        showToast('success', 'Expansion removed')
      }
    } catch {
      showToast('error', 'Failed to remove expansion')
    }
    setSaving(false)
  }

  /* ─── Drag handlers (dnd-kit) ───
     Split sensors so each input gets the right activation:
     - Mouse: distance-based (8px). Desktop users expect click-and-
       drag to start immediately; a quick click stays a click and
       falls through to selection / scrollbar drag.
     - Touch: delay-based (500ms / 5px tolerance). Quick taps and
       swipes fall through to the browser so iPad keeps native
       horizontal scroll on wide panels; hold half a second on a
       key to start a drag.
     KeyboardSensor stays for a11y. */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // iPad-tuned: 250ms feels responsive without false-firing during a
    // scroll swipe (which moves > 8px well within that window). 8px
    // tolerance is forgiving for a finger that can't sit perfectly
    // still while pressing.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  )

  // Currently-dragged picker item — used by the DragOverlay below so a
  // chip dragged out of its scroll-column doesn't get clipped (the
  // overlay renders outside the column at the document root).
  const [activeDragChip, setActiveDragChip] = useState<PickerItem | null>(null)
  // Mirror of activeDragChip but for key→key drags. Holds the
  // source key's pick-list info so the DragOverlay can render the
  // SAME chip-style preview as a picker chip drag — consistent
  // visual language regardless of where the drag started.
  const [activeDragKeyChip, setActiveDragKeyChip] = useState<{
    name: string
    code: string | null
    type: string | null
  } | null>(null)

  // Auto-scroll the chassis container while a chip is being dragged
  // near its top or bottom edge. dnd-kit's built-in autoscroll only
  // walks ANCESTORS of the active draggable, but the chip's draggable
  // lives inside the bottom-sheet picker — a sibling of the chassis,
  // not an ancestor. So we listen to pointermove / touchmove during
  // the drag and scroll the chassis manually.
  useEffect(() => {
    if (!activeDragChip) return
    if (typeof window === 'undefined') return
    const scroller = chassisScrollerRef.current
    if (!scroller) return

    const EDGE_PX = 80 // distance from edge that triggers scrolling
    const MAX_SPEED = 18 // pixels per frame at the very edge
    let pointerY = -1
    let raf = 0

    function onPointerMove(e: PointerEvent | TouchEvent) {
      if ('touches' in e) {
        if (e.touches.length === 0) return
        pointerY = e.touches[0].clientY
      } else {
        pointerY = e.clientY
      }
    }

    function step() {
      const sc = chassisScrollerRef.current
      if (!sc) {
        raf = requestAnimationFrame(step)
        return
      }
      const rect = sc.getBoundingClientRect()
      const fromTop = pointerY - rect.top
      const fromBottom = rect.bottom - pointerY
      let dy = 0
      if (pointerY >= 0) {
        if (fromTop < EDGE_PX && fromTop >= 0) {
          // Closer to the edge → faster scroll. Ratio is 0..1.
          const ratio = 1 - fromTop / EDGE_PX
          dy = -Math.round(MAX_SPEED * ratio)
        } else if (fromBottom < EDGE_PX && fromBottom >= 0) {
          const ratio = 1 - fromBottom / EDGE_PX
          dy = Math.round(MAX_SPEED * ratio)
        }
      }
      if (dy !== 0) {
        sc.scrollTop += dy
      }
      raf = requestAnimationFrame(step)
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('touchmove', onPointerMove, { passive: true })
    raf = requestAnimationFrame(step)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('touchmove', onPointerMove)
      cancelAnimationFrame(raf)
    }
  }, [activeDragChip])

  function handleDndStart(event: DragStartEvent) {
    if (!canEditKeys) return
    const data = event.active.data.current as DragData | undefined
    if (!data) return
    if (data.kind === 'key') {
      setDragSourceId(data.sourceId)
      setSelectedKeyId(data.sourceId)
      setActiveDragChip(null)
      // Capture the source key's pick-list info so the DragOverlay
      // renders a chip-style floating preview — same look as a chip
      // dragged out of the picker. Empty source keys won't reach
      // this branch (canDrag gates on !isEmpty).
      const src = getKey(data.sourceId)
      if (src && src.pickListItemId != null) {
        const code = src.pickListItemId
          ? pickListItems.find((p) => p.id === src.pickListItemId)?.code ?? null
          : null
        setActiveDragKeyChip({
          name: src.pickListItemName ?? '',
          code,
          type: src.pickListItemType ?? null,
        })
      } else {
        setActiveDragKeyChip(null)
      }
      // Mobile only: fully hide the bottom-sheet inspector during a
      // key→key drag so the WHOLE chassis is visible — not just the
      // top half. Unlike chip drags (which need the picker visible
      // because that's the drag source), key drags pull from the
      // chassis itself, so we can clear the sheet entirely. Save the
      // prior open state + snap so we put it back on drop / cancel.
      // Desktop is untouched (the picker is a separate floating
      // panel, not a bottom sheet).
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        preChipDragSnapRef.current = pickerSnap
        keyDragHidInspectorRef.current = inspectorOpen
        if (inspectorOpen) setInspectorOpen(false)
      } else {
        // Desktop: keep the inspector + picker visible during drag
        // (the picker doesn't cover the chassis there).
        setInspectorOpen(true)
        if (canEditKeys) setPickerMode(true)
      }
    } else if (data.kind === 'picklist') {
      setDragSourceId(null)
      setActiveDragChip(data.item)
      // Mobile only: auto-collapse the bottom sheet to peek the
      // moment a chip drag starts. Reveals the chassis above so the
      // user can see where to drop. Desktop's picker is a right-
      // side floating panel — nothing to collapse there, so we
      // skip the snap mutation entirely on lg+.
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        preChipDragSnapRef.current = pickerSnap
        // Snapshot the picker list's scrollTop before we shrink the
        // sheet to peek. When the visible area collapses, the browser
        // clamps scrollTop down to 0 because the (smaller) viewport
        // now fits the content — we need this number to put the user
        // back where they were on drop.
        preChipDragScrollTopRef.current = mobilePickerScrollRef.current?.scrollTop ?? null
        setPickerSnap('peek')
      }
    }
  }

  function handleDndEnd(event: DragEndEvent) {
    const activeData = event.active.data.current as DragData | undefined
    const overData = event.over?.data.current as { kind: 'key'; keyId: string } | undefined
    const targetId = overData?.kind === 'key' ? overData.keyId : null

    if (activeData && targetId) {
      if (activeData.kind === 'key' && targetId !== activeData.sourceId) {
        const sourceKey = getKey(activeData.sourceId)
        if (sourceKey) {
          // Overwrite: source content -> target, source becomes empty
          updateKey(targetId, {
            pickListItemId: sourceKey.pickListItemId,
            pickListItemName: sourceKey.pickListItemName,
            pickListItemType: sourceKey.pickListItemType,
            triggerMode: sourceKey.triggerMode,
            talkMode: sourceKey.talkMode,
            status: isRequestMode ? 'changed' : (sourceKey.pickListItemId ? 'assigned' : 'empty'),
          })
          updateKey(activeData.sourceId, {
            pickListItemId: null,
            pickListItemName: null,
            pickListItemType: null,
            triggerMode: 'latch',
            talkMode: 'tl',
            status: isRequestMode ? 'changed' : 'empty',
          })
          // Same reasoning as handleDndStart — avoid selectKey()'s
          // tap-to-toggle behavior so the picker doesn't blink on
          // touch drops to the source key (or any already-selected
          // key). setSelectedKeyId directly; pickerMode +
          // inspectorOpen are already true from the start of the drag.
          setSelectedKeyId(targetId)
          flashKey(targetId, '#10b981')
        }
      } else if (activeData.kind === 'picklist') {
        const item = activeData.item
        updateKey(targetId, {
          pickListItemId: item.id,
          pickListItemName: item.name,
          pickListItemType: item.type,
          // Pick-list drops default to momentary (push-to-talk) — matches
          // assignPickerItem so tap-to-assign and drag-to-assign behave
          // the same. Talk default 'tl' (Talk + Listen).
          triggerMode: 'momentary',
          talkMode: 'tl',
          status: isRequestMode ? 'changed' : 'assigned',
        })
        // Move the cyan highlight onto the just-dropped-on key so the
        // user can see exactly where the chip landed — feels more
        // intuitive than the highlight staying on whichever key
        // originally opened the picker. We bypass selectKey() (which
        // toggles closed when the same key is clicked twice) and
        // setSelectedKeyId directly; pickerMode + inspectorOpen are
        // already true so the picker stays open and the user can keep
        // dragging chip after chip.
        setSelectedKeyId(targetId)
        flashKey(targetId, '#10b981')
      }
    }

    setDragSourceId(null)
    setActiveDragChip(null)
    setActiveDragKeyChip(null)
    if (preChipDragSnapRef.current) {
      setPickerSnap(preChipDragSnapRef.current)
      preChipDragSnapRef.current = null
    }
    if (keyDragHidInspectorRef.current) {
      setInspectorOpen(true)
      keyDragHidInspectorRef.current = false
    }
    restorePickerScrollTop()
  }

  function handleDndCancel() {
    setDragSourceId(null)
    setActiveDragChip(null)
    setActiveDragKeyChip(null)
    if (preChipDragSnapRef.current) {
      setPickerSnap(preChipDragSnapRef.current)
      preChipDragSnapRef.current = null
    }
    if (keyDragHidInspectorRef.current) {
      setInspectorOpen(true)
      keyDragHidInspectorRef.current = false
    }
    restorePickerScrollTop()
  }

  // Defer the scrollTop restore to a rAF after the snap state has
  // taken effect — the sheet height animates back to its previous
  // size, and only then can the scroll container actually accept the
  // saved offset (before that its scrollHeight was smaller than the
  // target offset, so the assignment would be clamped to 0).
  function restorePickerScrollTop() {
    const target = preChipDragScrollTopRef.current
    preChipDragScrollTopRef.current = null
    if (target == null) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = mobilePickerScrollRef.current
        if (el) el.scrollTop = target
      })
    })
  }

  /* ─── Build picker items (PickList + PTP) ─── */
  // PTP items are now real PickListItems (auto-created on page load)
  // Match PTP PickListItems to members by name for position display
  const ptpPositionMap = new Map(ptpMembers.map((m) => [m.name, m.position]))

  const allPickerItems: PickerItem[] = pickListItems.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    type: p.type,
    position: p.type === 'PTP' ? (ptpPositionMap.get(p.name) ?? null) : null,
  }))

  const filterTypes = ['All', 'PTP', 'CONF', 'IFB', 'Audio', 'GRP']
  // Picker filter labels are spelled out — abbreviations like CONF /
  // PTP / GRP read fine in the data model but on the user-facing
  // dropdown the full word is clearer for crew browsing the picker.
  // IFB stays (industry standard acronym), Audio I/O reads cleanest.
  const filterTypeLabel = (t: string) => {
    switch (t) {
      case 'All': return 'All function types'
      case 'PTP': return 'Point to Point'
      case 'CONF': return 'Conferences'
      case 'IFB': return 'IFB'
      case 'Audio': return 'Audio'
      case 'GRP': return 'Group'
      default: return t
    }
  }

  const filteredPickerItems = allPickerItems.filter((item) => {
    const matchesFilter =
      pickerFilter === 'All' ||
      (pickerFilter === 'Audio' ? item.type === 'Audio_IO' : item.type === pickerFilter)
    // Trim and lowercase defensively — handles iOS keyboards that inject
    // leading whitespace or auto-capitalized characters.
    const searchLower = pickerSearch.trim().toLowerCase()
    const matchesSearch =
      !searchLower ||
      item.name.toLowerCase().includes(searchLower) ||
      (item.code && item.code.toLowerCase().includes(searchLower)) ||
      (item.position && item.position.toLowerCase().includes(searchLower))
    return matchesFilter && matchesSearch
  })

  // Group by type, then natural-sort within each group so codes like
  // C1, C2, C10, C20 appear in numeric order (plain alphabetical would
  // give C1, C10, C11, ... C2, C20 once zero-padding is removed).
  const groupedItems: Record<string, PickerItem[]> = {}
  for (const item of filteredPickerItems) {
    const group = item.type
    if (!groupedItems[group]) groupedItems[group] = []
    groupedItems[group].push(item)
  }
  for (const group of Object.keys(groupedItems)) {
    groupedItems[group].sort((a, b) => {
      const aParts = a.name.match(/(\d+|\D+)/g) ?? []
      const bParts = b.name.match(/(\d+|\D+)/g) ?? []
      const len = Math.min(aParts.length, bParts.length)
      for (let i = 0; i < len; i++) {
        const ap = aParts[i], bp = bParts[i]
        const aIsNum = /^\d+$/.test(ap), bIsNum = /^\d+$/.test(bp)
        if (aIsNum && bIsNum) {
          const d = parseInt(ap, 10) - parseInt(bp, 10)
          if (d !== 0) return d
        } else {
          const d = ap.localeCompare(bp, undefined, { sensitivity: 'base' })
          if (d !== 0) return d
        }
      }
      return aParts.length - bParts.length
    })
  }

  const typeLabels: Record<string, string> = {
    PTP: 'Point to Point',
    CONF: 'Conferences',
    IFB: 'IFB',
    Audio_IO: 'Audio I/O',
    GRP: 'Groups',
  }

  /* ─── Selected key info for inspector ─── */
  const selectedKey = selectedKeyId ? getKey(selectedKeyId) : null
  const selectedKeyParsed = selectedKeyId ? parseKeyId(selectedKeyId) : null

  /* ─── Trigger mode label ─── */
  function triggerLabel(mode: string): string {
    if (mode === 'latch') return 'L'
    if (mode === 'momentary') return 'M'
    if (mode === 'auto') return 'A'
    return ''
  }

  /* ─── Render key ─── */
  const renderKey = useCallback(
    (keyState: KeyState) => {
      const id = keyId(keyState.keyIndex, keyState.page, keyState.expansion)
      const isSelected = selectedKeyId === id
      const isDragging = dragSourceId === id
      const isFlashing = flashingKey?.id === id
      const isEmpty = keyState.status === 'empty'
      const isAssigned = keyState.status === 'assigned'
      const isChanged = keyState.status === 'changed'
      const isSubmitted = keyState.status === 'submitted'

      // Review mode: check if this key has a pending change
      const reviewChange = reviewChangesMap.get(id)
      const hasReviewChange = !!reviewChange
      const isRejected = hasReviewChange && rejectedKeyIds.has(id)

      // Paste preview overlay: when the user long-presses Paste we
      // render the would-be result inline on the chassis instead of
      // popping a modal. For each key that has a clipboard entry
      // differing from its current value, force a green border and
      // overlay each CHANGED piece (name / trigger / talk) in green.
      // Same-value matches stay untouched so the user sees only the
      // actual deltas — useful when copy/paste flips one indicator
      // without changing the channel itself.
      const pasteEntry = pastePreviewOpen && panelClipboard
        ? panelClipboard.entries.find(
            (e) => e.keyIndex === keyState.keyIndex
              && e.page === keyState.page
              && e.expansion === keyState.expansion,
          )
        : undefined
      const pasteNameChange = !!pasteEntry
        && (pasteEntry.pickListItemId ?? null) !== (keyState.pickListItemId ?? null)
      const pasteTriggerChange = !!pasteEntry
        && (pasteEntry.triggerMode ?? 'latch') !== (keyState.triggerMode ?? 'latch')
      const pasteTalkChange = !!pasteEntry
        && (pasteEntry.talkMode ?? 'tl') !== (keyState.talkMode ?? 'tl')
      // Border + overall "this row will change" flag is true if ANY
      // of the three differ. Drives the green chip outline.
      const pasteWillChange = pasteNameChange || pasteTriggerChange || pasteTalkChange
      const pastePreviewName = pasteNameChange ? (pasteEntry?.pickListItemName ?? null) : null

      const canDrag = !isReviewMode && !isEmpty && canEditKeys
      const canDrop = !isReviewMode && canEditKeys

      const onTileClick = () => {
        if (isReviewMode && hasReviewChange) {
          toggleRejectKey(id)
        } else if (!isReviewMode) {
          selectKey(id)
        }
      }

      const buildClassName = (isDragOver: boolean) => {
        let keyClasses = 'group relative flex flex-col cursor-pointer transition-all duration-[180ms]'
        keyClasses += ' w-16 h-16 rounded-md border-2'
        keyClasses += ' bg-[#202020] shadow-[0_4px_6px_rgba(0,0,0,0.3)]'

        if (isRejected) {
          keyClasses += ' border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.08)]'
        } else if (hasReviewChange) {
          keyClasses += ' border-[#f59e0b] shadow-[0_0_12px_rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.06)]'
        } else if (isAssigned) keyClasses += ' border-[#3a3a3a]'
        else if (isChanged) keyClasses += ' border-[#f59e0b] shadow-[0_0_12px_rgba(245,158,11,0.4)]'
        else if (isSubmitted) keyClasses += ' border-[#10b981] shadow-[0_0_12px_rgba(16,185,129,0.4)]'
        else keyClasses += ' border-[#3a3a3a]'

        // Paste-preview wins over the regular assigned/changed colors
        // but loses to isSelected / isDragOver below so the user still
        // sees their interactive cues during the preview.
        if (pasteWillChange) keyClasses += ' !border-[#10b981] !shadow-[0_0_14px_rgba(16,185,129,0.5)]'
        if (isSelected) keyClasses += ' !border-[#22a7d3] !shadow-[0_0_16px_rgba(34,167,211,0.5)] -translate-y-1'
        if (isDragging) keyClasses += ' opacity-30 scale-[0.92]'
        // Scale + glow gives a clear "you're dropping here" cue. The
        // DndContext above is configured with MeasuringStrategy.Always
        // so the droppable rect re-measures every frame and the
        // larger scaled rect is what dnd-kit checks against — no
        // missed drops at the edge.
        if (isDragOver) keyClasses += ' !border-[#22a7d3] !shadow-[0_0_28px_rgba(34,167,211,0.85)] !bg-[rgba(34,167,211,0.18)] !scale-125 z-10'
        if (!isSelected && !isDragging && !isDragOver && !hasReviewChange) keyClasses += ' hover:-translate-y-[2px] hover:border-[#4a4a4a]'
        if (hasReviewChange) keyClasses += ' hover:scale-[0.96] active:scale-[0.92]'
        return keyClasses
      }

      const flashStyle = isFlashing ? { boxShadow: `0 0 20px ${flashingKey.color}80` } : undefined

      const tileBody = (
        <>
          {/* Tally */}
          <div className="mx-auto mt-1.5 h-1 w-[60%] rounded-sm"
            style={{
              background: isRejected
                ? '#ef4444'
                : hasReviewChange
                ? '#f59e0b'
                : isAssigned || isSubmitted
                ? '#10b981'
                : isChanged
                ? '#f59e0b'
                : '#333',
              boxShadow: isRejected
                ? '0 0 8px rgba(239,68,68,0.7)'
                : hasReviewChange
                ? '0 0 8px rgba(245,158,11,0.7)'
                : isAssigned || isSubmitted
                ? '0 0 8px rgba(16,185,129,0.7)'
                : isChanged
                ? '0 0 8px rgba(245,158,11,0.7)'
                : 'none',
            }}
          />
          {/* Display */}
          <div className="flex flex-1 items-center justify-center p-1 relative">
            {pasteWillChange ? (
              // Paste preview takes precedence over the normal name
              // rendering — show what the key WILL hold in green so
              // the chassis itself reads as a faithful preview.
              // Empty incoming = the key is being cleared; render a
              // strikethrough "Empty" so the cleared state is obvious.
              <span className={`text-[9px] font-bold text-[#10b981] text-center whitespace-nowrap overflow-hidden max-w-full ${pastePreviewName ? '' : 'italic opacity-80'}`}>
                {pastePreviewName ?? 'Empty'}
              </span>
            ) : hasReviewChange ? (
              <div className="flex flex-col items-center gap-0.5 max-w-full overflow-hidden">
                {isRejected ? (
                  <span className="text-[9px] font-bold text-red-400 text-center whitespace-nowrap overflow-hidden max-w-full line-through">
                    {reviewChange.toName ?? 'Empty'}
                  </span>
                ) : (
                  <>
                    {reviewChange.fromName && (
                      <span className="text-[8px] text-red-400 line-through whitespace-nowrap overflow-hidden max-w-full opacity-70">
                        {reviewChange.fromName}
                      </span>
                    )}
                    <span className="text-[9px] font-bold text-[#f59e0b] text-center whitespace-nowrap overflow-hidden max-w-full">
                      {reviewChange.toName ?? 'Empty'}
                    </span>
                  </>
                )}
              </div>
            ) : isEmpty ? (
              <span className="text-2xl font-light leading-none text-[#3b4352]">+</span>
            ) : (
              <span className="text-[9px] font-bold text-white text-center whitespace-nowrap overflow-hidden max-w-full">
                {/* PTP keys show just the first name — the surface
                    is too small to read full names at 9px and the
                    person's first name is the meaningful talkback
                    target. Other function types (CONF / IFB / GRP /
                    Audio I/O) still show the full label. */}
                {keyState.pickListItemType === 'PTP'
                  ? (keyState.pickListItemName ?? '').split(' ')[0]
                  : keyState.pickListItemName}
              </span>
            )}
          </div>
          {/* Trigger + talk indicators. During paste preview the
              displayed values come from the clipboard entry (so the
              key reads as its post-paste state), and the indicator
              colour flips to green for whichever mode is actually
              changing — same green as the chip border + name overlay.
              When not previewing, the existing amber / cyan stay. */}
          {(() => {
            // Effective populated state under the preview. When the
            // paste would clear this key, hide indicators entirely
            // (the body already shows a green "Empty").
            const willHavePick = pasteWillChange
              ? (pasteEntry?.pickListItemId != null)
              : !isEmpty
            if (isReviewMode || !willHavePick) return null
            const displayTriggerMode = pasteWillChange && pasteEntry?.pickListItemId != null
              ? (pasteEntry.triggerMode ?? 'latch')
              : keyState.triggerMode
            const displayTalkMode = pasteWillChange && pasteEntry?.pickListItemId != null
              ? (pasteEntry.talkMode ?? 'tl')
              : keyState.talkMode
            const triggerClass = pasteTriggerChange ? 'text-[#10b981]' : 'text-[#f59e0b]'
            const talkClass = pasteTalkChange ? 'text-[#10b981]' : 'text-[#22a7d3]'
            return (
              <>
                <div className={`absolute bottom-1 right-1.5 text-[9px] font-extrabold opacity-85 uppercase ${triggerClass}`}>
                  {displayTriggerMode === 'latch' ? 'L' : triggerLabel(displayTriggerMode)}
                </div>
                <div className={`absolute bottom-1 left-1.5 text-[9px] font-extrabold opacity-85 uppercase ${talkClass}`}>
                  {displayTalkMode === 't' ? 'T' : displayTalkMode === 'l' ? 'L' : 'TL'}
                </div>
              </>
            )
          })()}
        </>
      )

      return (
        <PanelKeyTile
          key={id}
          id={id}
          canDrag={canDrag}
          canDrop={canDrop}
          buildClassName={buildClassName}
          flashStyle={flashStyle}
          onClick={onTileClick}
        >
          {tileBody}
        </PanelKeyTile>
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedKeyId, dragSourceId, flashingKey, canEditKeys, isRequestMode, isReviewMode, reviewChangesMap, rejectedKeyIds, keys, pastePreviewOpen, panelClipboard]
  )

  /* ─── Render a panel block (2D grid: cols × rows within one block) ─── */
  function renderBlock(visibleKeys: KeyState[], startIdx: number, cols: number, rows: number) {
    const count = cols * rows
    const blockKeys = visibleKeys.slice(startIdx, startIdx + count)

    return (
      <div className="p-3.5 rounded-lg">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {blockKeys.map((k) => renderKey(k))}
        </div>
      </div>
    )
  }

  /* ─── Render a full panel (all blocks for one expansion) ─── */
  function renderPanel(expansion: number) {
    const visibleKeys = getVisibleKeys(activePage, expansion)
    const panelLayout = expansion === 0 ? layout : getExpansionLayout(equipment.hardwareType)!
    const { colsPerBlock, rowsPerBlock, panelRows, blocksPerPanelRow } = panelLayout
    const keysPerBlock = colsPerBlock * rowsPerBlock

    // For RSP-2318: main panel (3 blocks) should left-align under expansion (4 blocks)
    const needsLeftAlign = expansion === 0
      && expansionCount > 0
      && getExpansionLayout(equipment.hardwareType) !== null
      && layout.blocksPerPanelRow < (getExpansionLayout(equipment.hardwareType)?.blocksPerPanelRow ?? 0)

    const panelRowElements: React.ReactNode[] = []
    let blockIdx = 0
    for (let row = 0; row < panelRows; row++) {
      const blocks: React.ReactNode[] = []
      for (let b = 0; b < blocksPerPanelRow; b++) {
        const startIdx = blockIdx * keysPerBlock
        blocks.push(
          <div key={b}>
            {renderBlock(visibleKeys, startIdx, colsPerBlock, rowsPerBlock)}
          </div>
        )
        blockIdx++
      }
      panelRowElements.push(
        <div key={row} className={`flex gap-3.5 flex-nowrap ${needsLeftAlign ? 'justify-start' : ''}`}>
          {blocks}
        </div>
      )
    }
    return panelRowElements
  }

  /* ═══════════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════════ */

  const memberName = member ? `${member.firstName} ${member.lastName}` : 'Unassigned'
  const memberMeta = [member?.position, member?.location].filter(Boolean).join(' \u00B7 ')

  return (
    <>
      {/* Stable id avoids the SSR / client hydration mismatch on
          dnd-kit's auto-generated aria-describedby IDs (counter starts
          fresh on each side without one). */}
      <DndContext
        id="panel-studio-dnd"
        sensors={sensors}
        // Snap the chip's centre to the cursor for both visual AND
        // collision detection. (Same modifier on DragOverlay alone
        // would only shift the visual, leaving collision behind at
        // the click-offset position — drops would miss the target the
        // user is visually hovering.)
        modifiers={activeDragChip || activeDragKeyChip ? [snapCenterToCursor] : []}
        // Re-measure droppable rects continuously while dragging so a
        // drop target that grows visually on hover (scale-125) keeps
        // its collision rect in sync with what the user sees. Without
        // this, dnd-kit caches the rect at drag start and drops near
        // the edge land outside the cached rect.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDndStart}
        onDragEnd={handleDndEnd}
        onDragCancel={handleDndCancel}
      >
      {/* pb-20 (mobile only) reserves enough space for the Save
          button to clear the BottomNav without burning so much of
          the chassis area that a 32-key + 1 expansion (or 12/16-key
          + 2 expansions) needlessly starts scrolling. The Save
          button's bottom edge ends up tucked under the BottomNav's
          empty-padding strip; the icon row stays fully visible.
          Desktop has no BottomNav so no padding there. */}
      <div className="flex flex-col pb-20 sm:pb-0" style={{ height: 'calc(100dvh - 56px)' }}>
        <div className="flex flex-1 overflow-hidden relative min-h-0">

          {/* ─── Editor workspace ─── */}
          <div className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative ${inspectorOpen ? 'lg:pr-0' : ''}`}>
            {/* Back link — pinned to the very top of the workspace.
                User-only accounts can't access the project page (proxy
                blocks it), so route them back to My Equipment instead.
                Hidden in browse mode AND in project-only switcher mode
                (crew/user) — both modes render their own header below. */}
            {!isBrowseMode && !hasProjectOnlySwitcher && (
              // Match My Equipment list page header exactly: pt-5 +
              // PageHeader (non-inline, bottomBorder) gives the same
              // title row height + gap + divider. The Back button is
              // absolutely positioned inside the wrapper so it sits
              // at the right edge of the title row WITHOUT adding to
              // the flow — the divider stays at the same Y as the
              // list page. The button is vertically centered to the
              // title's line-box; on mobile it extends ~2px past the
              // line-box, which still leaves a clear ~10px gap above
              // the divider so there's no overlap.
              <div className="relative flex-shrink-0 pt-5">
                <PageHeader
                  title="My Equipment"
                  titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
                  bottomBorder
                />
                <div className="pointer-events-none absolute inset-x-0 top-5 mx-auto flex max-w-7xl px-4 sm:px-6 lg:px-8">
                  {/* Mobile: title line-box is 2rem (32px). Center
                      a 36px button on it via -my-0.5. Desktop: title
                      line-box is 2.25rem (36px) — button fits. */}
                  <div className="pointer-events-auto ml-auto flex h-8 items-center sm:h-9">
                    <button
                      onClick={() => {
                        const dest = isReviewMode
                          ? '/admin'
                          : isUserOnly
                            ? '/my-equipment'
                            : `/projects/${project.id}`
                        router.push(dest)
                      }}
                      className="inline-flex rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
                    >
                      Back
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Crew / user header bar — title left, project dropdown
                right (no member switcher). Replaces the Back button when
                arriving via /my-equipment. */}
            {hasProjectOnlySwitcher && browseProjects && (
              <div className="flex-shrink-0 mx-auto w-full max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
                {/* Mobile: title left, project dropdown right (half row),
                    then the under-title divider. Desktop: same row, but
                    project dropdown content-sized via sm:min-w. */}
                <div className="flex items-center justify-between gap-3">
                  <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    My Equipment
                  </h1>
                  <div className="flex w-1/2 justify-end sm:w-auto">
                    <BrowseProjectDropdown project={project} browseProjects={browseProjects} />
                  </div>
                </div>
                <div className="mt-2 w-full border-b border-white/20 sm:hidden" />
              </div>
            )}

            {/* Browse-mode header bar.
                Mobile: title row, then project full-width, then user
                full-width — three stacked rows.
                Desktop: 3-column grid — title left, user dropdown centered,
                project dropdown far right. */}
            {isBrowseMode && browseProjects && browseMembers && (
              <div className="flex-shrink-0 mx-auto w-full max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
                {/* Mobile — title + project dropdown share row 1
                    (dropdown half-row), divider under the title,
                    member switcher gets its own row 2 below.
                    Desktop — 3-column grid: title · member · project. */}
                <div className="flex flex-col gap-2 sm:hidden">
                  <div className="flex items-center justify-between gap-3">
                    <h1 className="text-2xl font-bold tracking-tight text-white">
                      My Equipment
                    </h1>
                    <div className="flex w-1/2 justify-end">
                      <BrowseProjectDropdown project={project} browseProjects={browseProjects} />
                    </div>
                  </div>
                  <div className="w-full border-b border-white/20" />
                  <BrowseMemberSwitcher project={project} currentEquipmentId={equipment.id} browseMembers={browseMembers} />
                </div>
                {/* Desktop layout */}
                <div className="hidden grid-cols-3 items-center gap-3 sm:grid">
                  <h1 className="justify-self-start text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    My Equipment
                  </h1>
                  <div className="justify-self-center">
                    <BrowseMemberSwitcher project={project} currentEquipmentId={equipment.id} browseMembers={browseMembers} />
                  </div>
                  <div className="justify-self-end">
                    <BrowseProjectDropdown project={project} browseProjects={browseProjects} />
                  </div>
                </div>
              </div>
            )}

            {/* Divider underneath the back-link / browse dropdowns.
                Drawn on an inner div so the line aligns with the
                content below (which lives inside the same px-4 sm:
                px-6 lg:px-8 padding) instead of the wider container
                edge. Same look as the bottomBorder divider on the
                Dashboard / Tasks / My Equipment / Projects pages.
                Hidden when the picker card is open — the picker's
                own controls border-b serves as the page divider in
                that mode, so we don't end up with two stacked lines.*/}
            {!(pickerMode && canEditKeys) && (isBrowseMode || hasProjectOnlySwitcher) && (
              <div className="flex-shrink-0 mx-auto hidden w-full max-w-7xl px-4 pt-4 sm:block sm:px-6 lg:px-8">
                <div className="border-b border-white/20" />
              </div>
            )}

            {/* Sibling-gear card row — every piece of equipment AND
                every radio assigned to the current member on this
                project. Browse mode lets admins switch panels without
                leaving; non-browse mode shows the row when at least
                one OTHER item exists alongside the current panel
                (e.g. a radio chip on the user's own panel studio). */}
            {siblingGear && siblingGear.length > 1 && (
              <SiblingGearRow
                gear={siblingGear}
                currentEquipmentId={equipment.id}
                projectId={project.id}
              />
            )}

            <div className={`relative flex flex-col items-center flex-1 min-h-0 ${(pickerMode && canEditKeys) ? 'justify-center sm:justify-start' : 'justify-center'}`}>

              {/* ─── Inline picker card (desktop only) ───
                  Sits at the very top of the studio workspace, between
                  the project/member dropdown row above and the user-
                  name strip below. Houses everything the picker needs:
                  function-type filter, trigger-mode for the selected
                  key, an Unassign button, search, and pick-list items
                  rendered as tab-style chips that wrap so many fit per
                  row. Function-type filter dictates which chips appear.
                  A close X in the top-right collapses the card. The
                  right-side inspector picker is hidden on desktop so
                  this card is the only picker UI; mobile keeps the
                  inspector picker untouched. */}
              {/* Paste preview now renders inline on the chassis
                  itself (green border + green incoming name on each
                  changed key) — no separate preview card / sheet. The
                  picker stays available during preview so the user
                  can compare without UI shuffling. */}
              {pickerMode && canEditKeys && (
                // Outer wrapper matches the chassis scrollable's
                // padding so vertical alignment looks right. Inner
                // wrapper sets its width to the measured chassis
                // width via ResizeObserver above — that guarantees the
                // card's left/right edges line up with the chassis
                // even as keys / expansions change the chassis size.
                // flex-shrink + min-h-0 lets the card give space back
                // to the chassis when expansions are active so both
                // fit in the viewport without page scroll.
                <div className="mx-auto hidden min-h-0 w-full max-w-7xl flex-shrink overflow-hidden px-4 pt-3 sm:px-6 lg:flex lg:px-8 lg:pt-4">
                  <div
                    // Inner card fills the outer container's content
                    // area. Vertical cap keeps the chassis below
                    // visible: max-h-[min(35vh,280px)] kicks the
                    // smaller value in on short laptop viewports so
                    // a 6-key panel still fits without forcing a
                    // scroll. Now a 2-column horizontal split:
                    // controls stacked vertically on the LEFT,
                    // function-type-filtered chip area on the RIGHT.
                    className="relative flex max-h-[min(35vh,280px)] min-h-0 w-full flex-row gap-4 border-b border-white/10 pb-4"
                  >
                    {/* Left column — picker controls stacked
                        vertically: Search on top, then Function Type
                        filter, Trigger Mode, Talk Keys, Clear Key.
                        Fixed-width so the right chip area gets the
                        rest of the row. */}
                    <div className="flex w-[260px] shrink-0 flex-col gap-2 border-r border-white/10 pr-4">
                      <input
                        type="text"
                        placeholder="Search…"
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        className="block w-full rounded-lg border border-white/10 px-3.5 py-2 text-sm text-gray-200 outline-none transition-colors placeholder:text-gray-200 hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
                        autoCapitalize="off"
                        autoCorrect="off"
                        autoComplete="off"
                        spellCheck={false}
                      />

                      <PickerSelect
                        value={pickerFilter}
                        onChange={setPickerFilter}
                        options={filterTypes.map((t) => ({
                          value: t,
                          label: filterTypeLabel(t),
                        }))}
                      />

                      <PickerSelect
                        value={selectedKey?.triggerMode || 'latch'}
                        onChange={(v) => { if (selectedKeyId) setTriggerMode(selectedKeyId, v) }}
                        options={[
                          { value: 'auto', label: 'Auto' },
                          { value: 'latch', label: 'Latching' },
                          { value: 'momentary', label: 'Momentary' },
                        ]}
                      />

                      <PickerSelect
                        value={selectedKey?.talkMode || 'tl'}
                        onChange={(v) => { if (selectedKeyId) setTalkMode(selectedKeyId, v) }}
                        options={[
                          { value: 'tl', label: 'Talk / Listen' },
                          { value: 't', label: 'Talk' },
                          { value: 'l', label: 'Listen' },
                        ]}
                      />

                      <button
                        type="button"
                        onClick={() => {
                          try { navigator.vibrate?.(15) } catch {}
                          if (selectedKeyId) clearKey(selectedKeyId)
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-3.5 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
                      >
                        {selectedKey?.pickListItemId ? 'Clear Key' : 'Unassigned'}
                      </button>
                    </div>

                    {/* Right column — chips populated by the Function
                        Type filter on the left. Single column now;
                        scrolls vertically when there are more chips
                        than fit. */}
                    {(() => {
                      const renderChip = (item: PickerItem) => {
                        const isActive = selectedKey?.pickListItemId === item.id
                        // PTP chips: show "FirstName L" instead of
                        // the full "First Last" so the chip stays
                        // narrow on the desktop grid. First name is
                        // capped at 7 chars (no ellipsis) so very
                        // long names like "Latreesse" / "Christopher"
                        // shrink to "Latrees" / "Christo" — the chip
                        // doesn't blow out its grid cell. Position
                        // truncates to its first 4 characters when
                        // the name part is longer than 8 chars total
                        // so the label still fits next to the name.
                        let displayName = item.name
                        let displayDetail: string | null = null
                        if (item.type === 'PTP') {
                          const parts = item.name.trim().split(/\s+/)
                          const firstFull = parts[0] ?? ''
                          const first = firstFull.length > 7 ? firstFull.slice(0, 7) : firstFull
                          const last = parts.length > 1 ? parts[parts.length - 1] : ''
                          displayName = last ? `${first} ${last.charAt(0).toUpperCase()}` : first
                          if (item.position) {
                            displayDetail = displayName.length > 8
                              ? item.position.slice(0, 4)
                              : item.position
                          }
                        } else if (item.code) {
                          displayDetail = item.code
                        }
                        return (
                          <PickerItemDraggable
                            key={`${item.type}-${item.id}`}
                            item={item}
                            canDrag={canEditKeys}
                            isActive={isActive}
                            onClick={() => selectedKeyId && assignPickerItem(selectedKeyId, item)}
                            className={`flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-[colors,transform] active:scale-95 ${
                              isActive
                                ? 'border-[#0178a3] bg-[#0178a3] text-white'
                                : 'border-white/10 bg-[#202020] text-gray-300 hover:border-white/20 hover:bg-[#2a2a2a] hover:text-white'
                            }`}
                          >
                            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{displayName}</span>
                            {item.type === 'PTP' && displayDetail && (
                              <span className={`overflow-hidden text-ellipsis whitespace-nowrap text-xs ${isActive ? 'text-white/85' : 'text-[#22a7d3]'}`}>
                                {displayDetail}
                              </span>
                            )}
                            {item.type !== 'PTP' && displayDetail && (
                              <span className={`font-mono text-xs ${isActive ? 'text-white/85' : 'text-[#22a7d3]'}`}>{displayDetail}</span>
                            )}
                          </PickerItemDraggable>
                        )
                      }
                      const renderGroup = (type: string, items: PickerItem[]) => (
                        <div key={type} className="flex flex-col gap-1.5">
                          {pickerFilter === 'All' && (
                            <div className="px-1 text-[10px] font-extrabold uppercase tracking-wider text-gray-500">
                              {typeLabels[type] || type} &middot; {items.length}
                              {type === 'PTP' && (
                                <span className="font-semibold normal-case opacity-60"> (panels & beltpacks)</span>
                              )}
                            </div>
                          )}
                          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
                            {items.map(renderChip)}
                          </div>
                        </div>
                      )
                      const allEntries = Object.entries(groupedItems)
                      // The chip column is absolute-positioned inside
                      // a relative flex slot so its content height
                      // doesn't push the row taller than the left
                      // column's natural height. The wrapper takes
                      // its width from `flex-1` but contributes 0px
                      // to the row's height — so the card sizes to
                      // the left column (5 controls), and chips
                      // scroll inside that allotted height.
                      return (
                        <div className="relative flex-1">
                          <div className="absolute inset-0 pl-[30px]">
                            {allEntries.length === 0 ? (
                              <div className="flex h-full items-center justify-center">
                                <div className="text-sm text-gray-500">No items found</div>
                              </div>
                            ) : (
                              <VerticalScroller
                                className="h-full"
                                scrollClassName="flex h-full flex-col gap-3 overflow-y-auto pr-9"
                                ariaLabel="picker items"
                              >
                                {allEntries.map(([type, items]) => renderGroup(type, items))}
                              </VerticalScroller>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* ─── Header (pinned) ───
                  Single layout for all viewports: identity info pushed
                  far-left, legend + expansion controls pushed far-right
                  via `justify-between`. Constrained to max-w-7xl
                  regardless of chassis size — tiny panels (2-key,
                  4-key) used to make the header track chassisWidth and
                  squeeze identity text into a stack of lines, while
                  the picker card stayed wide. Now header + picker share
                  the same comfortable container width so things stay
                  visually aligned no matter how small the chassis. */}
              <div className="w-full flex-shrink-0 pt-4 pb-2 lg:pt-3 lg:pb-3">
                {/* Single max-w-7xl container with px-4 sm:px-6 lg:px-8
                    so the inner edges land at the SAME 32px desktop
                    gutter as the picker card and every other page
                    section — important so identity / Copy / Save /
                    expansion controls all line up vertically with the
                    picker card edges below them. */}
                <div className={`mx-auto flex w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8 ${stackHeader ? 'flex-col sm:max-lg:flex-row sm:max-lg:flex-nowrap sm:max-lg:justify-between' : 'flex-nowrap justify-between'}`}>
                {/* Left: ID · name · meta · ip · project · hardware · key count
                    All separated by middle dots. Wraps via flex-wrap so
                    a long identity line doesn't push the right group
                    off-screen on narrow viewports — but the parent is
                    flex-nowrap so the two GROUPS stay on one row. */}
                <div className={`flex min-w-0 flex-col gap-y-0.5 overflow-hidden ${stackHeader ? 'items-center sm:max-lg:flex-1 sm:max-lg:items-start' : 'flex-1 items-center sm:items-start'}`}>
                  {/* Row 0: soft presence — other people currently
                      looking at this same panel. Names in white;
                      state shown as a cyan icon (eye = viewing,
                      pencil = editing) instead of a word. Hidden
                      when no one else is here. */}
                  {presenceViewers.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                      {presenceViewers.map((v, i) => (
                        <span key={v.userId} className="inline-flex items-center">
                          {i > 0 && (
                            <span className="mr-2 text-[#3a3a3a]">&middot;</span>
                          )}
                          <span className="text-white">
                            {v.firstName} {v.lastName}
                          </span>
                          {v.state === 'editing' ? (
                            <PencilIcon
                              aria-label="editing"
                              className="ml-1.5 size-3 text-[#22a7d3]"
                            />
                          ) : (
                            <EyeIcon
                              aria-label="viewing"
                              className="ml-1.5 size-3 text-[#22a7d3]"
                            />
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Row 1: ID · firstName lastName · position · location */}
                  <div className={`flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 justify-center ${stackHeader ? 'sm:max-lg:justify-start' : 'sm:justify-start'}`}>
                    {equipment.name && (
                      <span className="text-[18px] font-bold text-[#22a7d3] font-mono lg:text-[22px]">{equipment.name}</span>
                    )}
                    {equipment.name && (
                      <span className="text-xs text-[#3a3a3a]">&middot;</span>
                    )}
                    <span className="text-[18px] font-bold text-white truncate lg:text-[22px]">{memberName}</span>
                    {memberMeta && (
                      <>
                        <span className="text-xs text-[#3a3a3a]">&middot;</span>
                        <span className="text-[13px] text-gray-400">{memberMeta}</span>
                      </>
                    )}
                    {isReviewMode && (
                      <span className="ml-2 inline-flex items-center gap-2 rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/10 px-3 py-1">
                        <svg className="size-3.5 text-[#f59e0b]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                        </svg>
                        <span className="text-[11px] font-semibold text-[#f59e0b]">Reviewing change request</span>
                      </span>
                    )}
                  </div>
                  {/* Row 2: IP · project (show) name. Sits directly
                      below the identity row so the bigger name + role
                      strip stays clean and the secondary metadata
                      (link to panel UI, which show this is on) lives
                      on its own line. */}
                  <div className={`flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 justify-center ${stackHeader ? 'sm:max-lg:justify-start' : 'sm:justify-start'}`}>
                    {showIpAddress && equipment.ipAddress && (
                      <>
                        <a
                          // Panels carry the Riedel web UI under
                          // /remote-control/, so the link drops the
                          // user straight into that. Other categories
                          // (switches, antennas) just open the bare IP.
                          href={`http://${equipment.ipAddress}${equipment.category === 'panels' ? '/remote-control/' : ''}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          // Match the surrounding identity strip's font
                          // (no font-mono, no underline) — just stays
                          // cyan with a slightly brighter cyan on hover
                          // so it still reads as a clickable link.
                          className="text-[13px] text-[#22a7d3] hover:text-[#019bc7]"
                        >
                          {equipment.ipAddress}
                        </a>
                        <span className="text-xs text-[#3a3a3a]">&middot;</span>
                      </>
                    )}
                    <span className="text-xs text-gray-500">{project.name}</span>
                  </div>
                </div>

                {/* Right: on desktop = legend chips + expansion +/- +
                    Copy/Save. On mobile = Copy/Save only (the legend
                    and expansion controls move to the footer next to
                    the Main/Shift toggle so the header stays compact
                    on small screens). */}
                <div className={`flex flex-shrink-0 flex-wrap items-center gap-3 ${stackHeader ? 'justify-center sm:max-lg:justify-end' : ''}`}>
                  {/* Expansion controls — visible from sm+ (so they
                      sit to the right of the identity strip in
                      landscape phone too, not just desktop). The
                      color-swatch legend was removed per operator
                      feedback — the chassis itself is self-explanatory
                      after a few seconds, the legend was just noise.
                      Changed/Submitted draft indicators below are kept
                      ONLY when isRequestMode is active because there's
                      no other on-screen affordance for those states. */}
                  <div className="hidden flex-wrap items-center gap-x-2 gap-y-1 sm:flex">
                    {isRequestMode && (
                      <>
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                          <span className="w-[9px] h-[9px] rounded-sm bg-[#f59e0b] shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
                          Changed (draft)
                        </div>
                        <span className="text-xs text-[#3a3a3a]">&middot;</span>
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                          <span className="w-[9px] h-[9px] rounded-sm bg-[#10b981] shadow-[0_0_6px_rgba(16,185,129,0.4)] border border-[#10b981]" />
                          Submitted
                        </div>
                      </>
                    )}
                    {canManageExpansions && isExpandable && (
                      <div className="inline-flex items-center gap-2 text-xs text-gray-300">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Expansions</span>
                        <span className="font-semibold text-white">{expansionCount}</span>
                        <div className="inline-flex gap-1.5">
                          {expansionCount > 0 && (
                            <button
                              onClick={handleRemoveExpansion}
                              disabled={saving}
                              className="shrink-0 rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-red-500 transition-colors hover:border-red-500/40 hover:bg-red-500/[0.08] disabled:opacity-50"
                            >
                              &minus;
                            </button>
                          )}
                          {expansionCount < 6 && (
                            <button
                              onClick={handleAddExpansion}
                              disabled={saving}
                              className="shrink-0 rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-[#22a7d3] transition-colors hover:border-[#22a7d3]/40 hover:bg-[#22a7d3]/[0.08] disabled:opacity-50"
                            >
                              +
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Copy / Paste / Save — visible at sm+ so they
                      sit right of the expansion controls on landscape
                      phone too. Hidden in mobile portrait (Main/Shift
                      footer carries them there) and at lg+ when
                      stackHeader is true (small chassis on desktop —
                      the layout collapses to mobile-style and these
                      buttons move down to the footer below the
                      chassis). Hidden in review mode entirely. */}
                  {canEditKeys && !isReviewMode && (
                    <div className={`hidden items-center gap-2 sm:flex ${stackHeader ? 'lg:hidden' : ''}`}>
                      {(_currentUserRole === 'admin' || _currentUserRole === 'manager' || isAdminGlobal) && (
                        <>
                          <button
                            type="button"
                            onClick={handleCopyPanel}
                            className="shrink-0 rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
                          >
                            Copy
                          </button>
                          {panelClipboard && panelClipboard.entries.length > 0 && (
                            <button
                              type="button"
                              onClick={handlePasteClick}
                              onPointerDown={startLongPress}
                              onPointerUp={cancelLongPress}
                              onPointerLeave={cancelLongPress}
                              onPointerCancel={cancelLongPress}
                              title={`Paste from ${panelClipboard.sourceLabel} (hold to preview)`}
                              // Suppress iOS Safari's long-press
                              // callout (Copy / Look up / Translate)
                              // + Android Chrome's context menu so
                              // the hold-to-preview gesture fires
                              // cleanly instead of hijacking the press.
                              onContextMenu={(e) => e.preventDefault()}
                              style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
                              className={`shrink-0 select-none rounded-md border px-4 py-2 text-sm font-semibold transition-colors ${
                                pastePreviewOpen
                                  ? 'border-[#10b981] text-[#10b981] hover:bg-[#10b981]/10'
                                  : 'border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white'
                              }`}
                            >
                              Paste
                            </button>
                          )}
                        </>
                      )}
                      {!isRequestMode && (
                        <button
                          type="button"
                          onClick={handleSave}
                          disabled={saving}
                          className="shrink-0 rounded-md bg-[#0178a3] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                </div>
              </div>

              {/* ─── Mobile-only expansion row ───
                  Sits BELOW the user-name strip on mobile so the
                  expansion controls (and the request-mode Changed /
                  Submitted draft indicators) sit close to the
                  chassis. The Assigned / Unassigned color legend was
                  removed per operator feedback — the chassis itself
                  reads clearly enough. Hidden on desktop (lg+) where
                  the same controls live in the studio header's right
                  group. */}
              {(isRequestMode || (canManageExpansions && isExpandable)) && (
                <div className="flex w-full flex-shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 pb-2 sm:hidden">
                  {isRequestMode && (
                    <>
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                        <span className="w-[9px] h-[9px] rounded-sm bg-[#f59e0b] shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
                        Changed (draft)
                      </div>
                      <span className="text-xs text-[#3a3a3a]">&middot;</span>
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                        <span className="w-[9px] h-[9px] rounded-sm bg-[#10b981] shadow-[0_0_6px_rgba(16,185,129,0.4)] border border-[#10b981]" />
                        Submitted
                      </div>
                    </>
                  )}
                  {canManageExpansions && isExpandable && (
                    <div className="inline-flex items-center gap-2 text-xs text-gray-300">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Expansions</span>
                      <span className="font-semibold text-white">{expansionCount}</span>
                      <div className="inline-flex gap-1.5">
                        {expansionCount > 0 && (
                          <button
                            onClick={handleRemoveExpansion}
                            disabled={saving}
                            className="shrink-0 rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-red-500 transition-colors hover:border-red-500/40 hover:bg-red-500/[0.08] disabled:opacity-50"
                          >
                            &minus;
                          </button>
                        )}
                        {expansionCount < 6 && (
                          <button
                            onClick={handleAddExpansion}
                            disabled={saving}
                            className="shrink-0 rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-[#22a7d3] transition-colors hover:border-[#22a7d3]/40 hover:bg-[#22a7d3]/[0.08] disabled:opacity-50"
                          >
                            +
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ─── Scrollable panel content ─── */}
              <div
                ref={chassisScrollerRef}
                className={`flex-[0_1_auto] min-h-0 w-full overflow-auto p-2 sm:p-4 sm:px-6 lg:p-5 lg:px-8 flex transition-[padding-right] duration-300 ${inspectorOpen && !(pickerMode && canEditKeys) ? 'xl:pr-[420px] 2xl:pr-10' : ''}`}
              >
                <div className="min-w-min mx-auto" ref={chassisRef}>
                  {/* Single chassis card containing expansions + main panel */}
                  <div className="relative bg-[#2a2a2a] border border-white/[0.06] rounded-[14px] p-4 gap-2 sm:p-8 sm:gap-4 flex flex-col items-center">
                    {/* Hardware type + key count, top-right corner of
                        the chassis card. Plain cyan label — no
                        engraved silkscreen shadow. */}
                    <div className="pointer-events-none absolute right-4 top-3 text-sm font-bold uppercase tracking-[0.18em] tabular-nums leading-none text-[#22a7d3]">
                      {(equipment.hardwareType || 'Unknown')} · {keyCount}-Key
                    </div>
                    {/* Expansion rows (rendered on top, reversed so
                        newest is at top). The cyan expansion-number
                        marker that floated to the right of each row
                        was scrapped — it looked off-balance after the
                        mobile padding tightening and the order is
                        already obvious visually (each row is the next
                        expansion module up from the main panel). */}
                    {Array.from({ length: expansionCount }, (_, i) => expansionCount - i).map((exp) => (
                      <div key={`exp-${exp}`} className="relative flex items-center">
                        {renderPanel(exp)}
                      </div>
                    ))}

                    {/* Divider between expansions and main panel */}
                    {expansionCount > 0 && (
                      <div className="w-full border-t border-white/[0.06] my-1" />
                    )}

                    {/* Main panel rows */}
                    {renderPanel(0)}
                  </div>
                </div>
              </div>


              {/* ─── Footer (pinned) ───
                  Mobile: Main/Shift toggle (centered) followed by
                  Copy / Paste / Save in their own row underneath.
                  Desktop: just the Main/Shift toggle, centered —
                  legend, expansion, and Copy/Save all live in the
                  studio header's right group on big screens.
                  Legend + expansion now live ABOVE the user-name
                  strip on mobile, not down here. */}
              <div className="flex-shrink-0 w-full px-4 pb-3 pt-2 lg:px-5 lg:pb-5 lg:pt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center sm:gap-3">
                {isReviewMode ? (
                  <>
                    {/* Review mode summary */}
                    <div className="text-[11px] text-gray-400 text-center">
                      {rejectedCount > 0 ? (
                        <>
                          <strong className="text-[#10b981] font-bold">{approvedCount}</strong> to approve
                          <span className="mx-1.5 text-gray-600">&middot;</span>
                          <strong className="text-red-400 font-bold">{rejectedCount}</strong> to deny
                        </>
                      ) : (
                        <>
                          <strong className="text-[#f59e0b] font-bold">{totalReviewKeys} key{totalReviewKeys !== 1 ? 's' : ''}</strong> requested by{' '}
                          <strong className="text-white">{pendingChangeRequests[0]?.submitterName}</strong>
                        </>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-500 -mt-1">
                      Tap a key to reject it
                    </div>
                    {/* Deny All / Approve buttons — each on its own
                        full-width row on mobile, inline cluster on
                        desktop. */}
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:gap-3">
                      <button
                        onClick={handleDenyAll}
                        disabled={reviewProcessing}
                        className="w-full bg-red-500 text-white border-none py-2.5 px-6 rounded-[10px] font-bold text-xs cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-600 transition-colors sm:w-auto"
                      >
                        {reviewProcessing ? 'Processing...' : 'Deny'}
                      </button>
                      <button
                        onClick={handleResolve}
                        disabled={reviewProcessing || approvedCount === 0}
                        className="w-full bg-[#10b981] text-white border-none py-2.5 px-6 rounded-[10px] font-bold text-xs cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#0ea472] transition-colors sm:w-auto"
                      >
                        {reviewProcessing ? 'Processing...' : approvedCount === totalReviewKeys ? 'Approve' : `Approve ${approvedCount}`}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Main/Shift toggle (panels only) — styled to
                        match the Chip component used in tabs/filters:
                        cyan-fill + white text when active, dark fill
                        with a hairline border when inactive. */}
                    {hasShiftPage ? (
                      // Mobile: full-width row, Main + Shift split 50/50
                      // via flex-1. Desktop: content-sized side-by-side.
                      <div className="flex w-full gap-2 sm:inline-flex sm:w-auto">
                        <button
                          type="button"
                          onClick={() => { setActivePage('main'); deselectAll() }}
                          className={`flex-1 rounded-md border px-4 py-2 text-sm font-semibold transition-colors sm:flex-none sm:shrink-0 ${
                            activePage === 'main'
                              ? 'border-[#0178a3] bg-[#0178a3]/20 text-[#22a7d3]'
                              : 'border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white'
                          }`}
                        >
                          Main
                        </button>
                        <button
                          type="button"
                          onClick={() => { setActivePage('shift'); deselectAll() }}
                          className={`flex-1 rounded-md border px-4 py-2 text-sm font-semibold transition-colors sm:flex-none sm:shrink-0 ${
                            activePage === 'shift'
                              ? 'border-[#0178a3] bg-[#0178a3]/20 text-[#22a7d3]'
                              : 'border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white'
                          }`}
                        >
                          Shift
                        </button>
                      </div>
                    ) : null}

                    {/* Submit changes — request mode (user role).
                        Centered at the bottom of the panel, both
                        mobile and desktop. Disabled when there are
                        no pending changes to submit. */}
                    {canEditKeys && isRequestMode && (() => {
                      const pendingChanges = keys.filter((k) => k.status === 'changed').length
                      return (
                        <button
                          type="button"
                          onClick={handleSubmit}
                          disabled={saving || pendingChanges === 0}
                          className="w-full rounded-lg bg-[#0178a3] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                        >
                          {saving
                            ? 'Submitting…'
                            : pendingChanges > 0
                              ? `Submit ${pendingChanges} change${pendingChanges === 1 ? '' : 's'}`
                              : 'Submit'}
                        </button>
                      )
                    })()}

                    {/* Mobile-portrait Copy / Paste / Save row —
                        sits below Main/Shift in column mode. Also
                        re-shown at lg+ when stackHeader is true
                        (small chassis on desktop, mobile-style
                        layout) so the buttons live below the chassis
                        like mobile rather than crowding the header.
                        When the clipboard has entries, Copy + Paste
                        share a single row (each 50%) so the operator
                        doesn't lose a whole row to a button that's
                        only meaningful when there's something to
                        paste. */}
                    {canEditKeys && (
                      <div className={`flex w-full flex-col gap-2 sm:hidden ${stackHeader ? 'lg:flex lg:w-auto lg:flex-row lg:items-center' : ''}`}>
                        {(_currentUserRole === 'admin' || _currentUserRole === 'manager' || isAdminGlobal) && (
                          // Inner row: Copy alone (full width) when
                          // the clipboard is empty; Copy + Paste split
                          // 50/50 when the clipboard has entries.
                          // flex-1 collapses to w-full when there's
                          // only one child, so no separate "no
                          // clipboard" branch is needed.
                          <div className="flex w-full gap-2">
                            <button
                              type="button"
                              onClick={handleCopyPanel}
                              className="flex-1 rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white lg:flex-none lg:shrink-0"
                            >
                              Copy
                            </button>
                            {panelClipboard && panelClipboard.entries.length > 0 && (
                              <button
                                type="button"
                                onClick={handlePasteClick}
                                onPointerDown={startLongPress}
                                onPointerUp={cancelLongPress}
                                onPointerLeave={cancelLongPress}
                                onPointerCancel={cancelLongPress}
                                title={`Paste from ${panelClipboard.sourceLabel} (hold to preview)`}
                                // iOS Safari's default long-press
                                // callout (Copy / Look up / Translate)
                                // hijacks our hold-to-preview gesture.
                                // Disable text selection + the touch
                                // callout on this button so the long-
                                // press fires the preview timer
                                // cleanly. onContextMenu preventDefault
                                // catches the right-click / long-press
                                // menu on Android Chrome too.
                                onContextMenu={(e) => e.preventDefault()}
                                style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
                                className={`flex-1 select-none rounded-md border px-4 py-2 text-sm font-semibold transition-colors lg:flex-none lg:shrink-0 ${
                                  pastePreviewOpen
                                    ? 'border-[#10b981] text-[#10b981] hover:bg-[#10b981]/10'
                                    : 'border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white'
                                }`}
                              >
                                Paste
                              </button>
                            )}
                          </div>
                        )}
                        {!isRequestMode && (
                          <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="w-full rounded-md bg-[#0178a3] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto lg:shrink-0"
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ─── Scrim (mobile bottom-sheet backdrop) ─── */}
          {inspectorOpen && (
            // Scrim opacity + click behaviour adapts to the snap
            // position. At "full" the scrim is opaque + tappable to
            // close (current behaviour). At "half" / "peek" the scrim
            // dims less and is `pointer-events-none` so the user can
            // still tap / drag chips onto keys above the sheet.
            <div
              className={`fixed inset-0 z-[199] lg:hidden transition-colors duration-200 ${
                pickerSnap === 'full'
                  ? 'bg-black/50'
                  : pickerSnap === 'half'
                  ? 'bg-black/20 pointer-events-none'
                  : 'bg-transparent pointer-events-none'
              }`}
              onClick={pickerSnap === 'full' ? closeInspector : undefined}
            />
          )}

          {/* ─── Inspector ───
              When picker mode is on for an editor, the desktop UI is
              the inline picker card at the top of the workspace —
              this aside should NOT show on lg+. The wrapper below
              uses `display: contents` normally so the aside lays out
              as if there were no wrapper, but flips to `lg:hidden`
              while picker+edit is active so the whole sub-tree (incl.
              the aside) is hidden on lg. Below lg the bottom-sheet
              inspector is still the picker UI on mobile/tablet. */}
          <div className={`contents ${(pickerMode && canEditKeys) ? 'lg:hidden' : ''}`}>
          <aside
            ref={inspectorRef}
            // Mobile-only inline height: explicit pixel height driven
            // by the snap state, with a live offset while the user is
            // actively dragging the handle. Desktop ignores the
            // inline height — `lg:!h-auto` lets the absolute-
            // positioned panel size to its content like before.
            // Gated on `mounted` so the server emits no style, the
            // first client render matches, and the height appears
            // post-hydration. Avoids the SSR/CSR style mismatch.
            style={(() => {
              if (!mounted) return undefined
              if (window.innerWidth >= 1024) return undefined
              const base = snapHeightPx(pickerSnap)
              const live = dragOffsetY != null
                ? Math.max(120, Math.min(window.innerHeight * 0.92, base - dragOffsetY))
                : base
              return { height: `${Math.round(live)}px` }
            })()}
            className={`
              w-full lg:!h-auto lg:w-[360px] bg-[#202020] lg:bg-[#2a2a2a] border-white/[0.06] flex-col overflow-hidden z-[200]
              /* Mobile: bottom sheet */
              fixed left-0 right-0 bottom-0 lg:top-auto
              lg:max-h-[calc(100%-48px)] lg:landscape:max-h-[calc(100%-48px)]
              rounded-t-[20px] lg:rounded-[14px]
              lg:border
              shadow-[0_-10px_40px_rgba(0,0,0,0.6)] lg:shadow-[-15px_10px_40px_rgba(0,0,0,0.6)]
              ${dragOffsetY == null ? 'transition-[height,transform] duration-[280ms] ease-[cubic-bezier(0.4,0,0.2,1)]' : ''}
              lg:transition-none
              /* Desktop: absolute overlay */
              lg:absolute lg:right-6 lg:top-6 lg:bottom-auto lg:left-auto
              ${inspectorOpen ? 'flex translate-y-0 lg:flex' : 'flex translate-y-full lg:hidden'}
            `}
          >
            {/* Drag handle — visible pill at the top of the bottom
                sheet on mobile only. Acts as the snap-point trigger:
                drag up to grow, drag down to shrink, release to snap
                to the nearest of peek / half / full. Tap toggles
                between full and half so users who don't realize it's
                draggable still have a way to get a half-screen view. */}
            <div
              {...sheetDragBind()}
              onClick={() =>
                setPickerSnap((s) => (s === 'full' ? 'half' : 'full'))
              }
              className="lg:hidden flex flex-shrink-0 cursor-grab touch-none select-none items-center justify-center pt-3 pb-2 active:cursor-grabbing"
              aria-label="Drag to resize, tap to toggle"
            >
              <div className="h-1.5 w-12 rounded-full bg-white/60" />
            </div>
            {/* Inspector header \u2014 picker mode strips the back arrow
                and "Pick destination" label so the row just holds
                a key-summary on the left and a big close X on the
                right. No bottom border on the picker-mode header
                because the controls section below has its own
                border-b that doubles as the divider. */}
            <div className={`px-[18px] py-4 flex items-center justify-between gap-2.5 flex-shrink-0 ${pickerMode ? '' : 'border-b border-white/[0.06]'}`}>
              <div className="flex-1 min-w-0 flex items-center gap-2.5">
                {pickerMode ? (
                  <div>
                    <div className="text-[13px] font-semibold text-white">
                      Key {selectedKeyParsed ? selectedKeyParsed.keyIndex + 1 : '?'}
                      <span className="text-gray-500"> &middot; </span>
                      {activePage === 'main' ? 'Main' : 'Shift'}
                      {selectedKeyParsed && selectedKeyParsed.expansion > 0 && (
                        <><span className="text-gray-500"> &middot; </span>Exp {selectedKeyParsed.expansion}</>
                      )}
                    </div>
                    {selectedKey?.pickListItemName && (
                      <div className="text-[10px] text-[#22a7d3] mt-0.5 uppercase tracking-wider font-semibold">
                        Currently: {selectedKey.pickListItemName}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="text-[13px] font-semibold text-white">
                      {selectedKey?.pickListItemName || 'Empty'}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5 uppercase tracking-wider font-semibold">
                      Key {selectedKeyParsed ? selectedKeyParsed.keyIndex + 1 : '?'} &middot; {activePage === 'main' ? 'Main' : 'Shift'}
                      {selectedKeyParsed && selectedKeyParsed.expansion > 0 && ` \u00B7 Exp ${selectedKeyParsed.expansion}`}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={closeInspector}
                aria-label="Close picker"
                className="flex size-12 shrink-0 items-center justify-center rounded-md bg-transparent text-3xl text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                &times;
              </button>
            </div>

            {/* Paste preview is rendered in-place on the chassis
                now (no bottom-sheet variant). The inspector stays
                showing whatever it was showing before. */}

            {/* Inspector body (detail view) */}
            {!pickerMode && (
              <div className="px-[18px] py-4 flex flex-col gap-[18px] overflow-y-auto flex-1">
                {/* Destination */}
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Destination</div>
                  <div
                    onClick={() => canEditKeys && setPickerMode(true)}
                    className={`bg-[#202020] border border-white/[0.08] rounded-[10px] px-3.5 py-3 flex items-center gap-3 transition-all ${canEditKeys ? 'cursor-pointer hover:border-[rgba(34,167,211,0.5)] hover:bg-[#262626]' : 'cursor-default'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white">
                        {selectedKey?.pickListItemName || 'None'}
                      </div>
                      {selectedKey?.pickListItemType && (
                        <div className="text-[10px] text-gray-500 mt-0.5 uppercase tracking-wider font-bold">
                          {selectedKey.pickListItemType}
                          {selectedKey.pickListItemId && selectedKey.pickListItemId > 0 && (
                            <> &middot; {pickListItems.find(p => p.id === selectedKey.pickListItemId)?.code || ''}</>
                          )}
                        </div>
                      )}
                    </div>
                    {canEditKeys && (
                      <div className="text-[11px] font-semibold text-gray-500">CHANGE &rsaquo;</div>
                    )}
                  </div>
                </div>

                {/* Trigger Mode */}
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Trigger Mode</div>
                  <select
                    value={selectedKey?.triggerMode || 'latch'}
                    onChange={(e) => selectedKeyId && setTriggerMode(selectedKeyId, e.target.value)}
                    disabled={!canEditKeys}
                    className="bg-[#202020] text-white border border-white/[0.08] px-3 py-2.5 rounded-lg text-[13px] outline-none cursor-pointer appearance-none disabled:opacity-50"
                  >
                    <option value="auto">Auto</option>
                    <option value="latch">Latching</option>
                    <option value="momentary">Momentary</option>
                  </select>
                </div>
              </div>
            )}

            {/* Picker view — mobile only. On desktop the floating
                picker card on top of the chassis is the single source
                of truth, so hide this in-inspector picker view there.
                Paste preview now renders inline on the chassis, so
                the picker view stays available alongside it. */}
            {pickerMode && (
              <div className="flex flex-col flex-1 min-h-0 sm:hidden">
                {/* Picker controls — all dropdowns use the shared
                    PickerSelect component (same as the desktop card)
                    so the look is consistent: full-width trigger,
                    cyan-fill on the selected option, single chevron.
                    The native <select> here was rendering its own
                    browser chevron alongside our custom one — hence
                    the "extra character" — switching to PickerSelect
                    fixes that and gives us trigger-mode + talk-key
                    dropdowns to match desktop. */}
                <div className="px-[18px] pt-0 pb-3.5 border-b border-white/[0.06] flex flex-col gap-2.5 flex-shrink-0">
                  {/* Row 1: either function-type dropdown + search-icon
                      button (default), or search input + X-close
                      taking over the same row when search is open.
                      X sits in the trailing (right) position where
                      the search icon was. */}
                  <div className="flex items-stretch gap-2">
                    {mobilePickerSearchOpen ? (
                      <>
                        <input
                          type="text"
                          autoFocus
                          placeholder="Search by name or code..."
                          value={pickerSearch}
                          onChange={(e) => setPickerSearch(e.target.value)}
                          className="min-w-0 flex-1 text-gray-200 border border-white/10 px-3.5 py-2 rounded-lg text-sm outline-none transition-colors placeholder:text-gray-200 hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
                          autoCapitalize="off"
                          autoCorrect="off"
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          onClick={() => { setMobilePickerSearchOpen(false); setPickerSearch('') }}
                          aria-label="Close search"
                          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
                        >
                          <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <PickerSelect
                            value={pickerFilter}
                            onChange={setPickerFilter}
                            options={filterTypes.map((t) => ({
                              value: t,
                              label: filterTypeLabel(t),
                            }))}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setMobilePickerSearchOpen(true)}
                          aria-label="Search"
                          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
                        >
                          <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.343-4.343m0 0A8 8 0 1 0 5.343 5.343a8 8 0 0 0 11.314 11.314Z" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>

                  {/* Row 2: Trigger mode + Talk/Listen + Unassigned
                      (clear key) all in one horizontal row. Each
                      takes a third of the width on mobile. */}
                  <div className="flex items-stretch gap-2">
                    <div className="min-w-0 flex-1">
                      <PickerSelect
                        value={selectedKey?.triggerMode || 'latch'}
                        onChange={(v) => { if (selectedKeyId) setTriggerMode(selectedKeyId, v) }}
                        options={[
                          { value: 'auto', label: 'Auto' },
                          { value: 'latch', label: 'Latching' },
                          { value: 'momentary', label: 'Momentary' },
                        ]}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <PickerSelect
                        value={selectedKey?.talkMode || 'tl'}
                        onChange={(v) => { if (selectedKeyId) setTalkMode(selectedKeyId, v) }}
                        options={[
                          { value: 'tl', label: 'Talk / Listen' },
                          { value: 't', label: 'Talk' },
                          { value: 'l', label: 'Listen' },
                        ]}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedKeyId) clearKey(selectedKeyId)
                        // Mobile: close the picker sheet after the
                        // clear so the user lands back on the
                        // chassis with the now-empty key visible —
                        // saves a tap to dismiss.
                        closeInspector()
                      }}
                      className="min-w-0 flex-1 truncate rounded-lg border border-white/10 px-4 py-3 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
                    >
                      {selectedKey?.pickListItemId ? 'Clear Key' : 'Unassigned'}
                    </button>
                  </div>
                </div>

                {/* Picker list — Unassigned/Clear was promoted into
                    the controls row above next to trigger/talk
                    dropdowns, so it no longer renders here. */}
                <div ref={mobilePickerScrollRef} className="px-[18px] py-3.5 overflow-y-auto flex-1 flex flex-col gap-[18px]">
                  {Object.entries(groupedItems).map(([type, items]) => (
                    <div key={type} className="flex flex-col gap-1.5">
                      <div className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider px-1">
                        {typeLabels[type] || type} &middot; {items.length}
                        {type === 'PTP' && (
                          <span className="opacity-60 font-semibold normal-case"> (panels & beltpacks)</span>
                        )}
                      </div>
                      {items.map((item) => {
                        const isActive = selectedKey?.pickListItemId === item.id
                        return (
                          <PickerItemDraggable
                            key={`${item.type}-${item.id}`}
                            item={item}
                            canDrag={canEditKeys}
                            isActive={isActive}
                            onClick={() => {
                              if (!selectedKeyId) return
                              assignPickerItem(selectedKeyId, item)
                              // Mobile-only picker: tapping a function
                              // type assigns it AND closes the picker
                              // so the user can immediately see the
                              // updated key on the chassis.
                              closeInspector()
                            }}
                            className={`rounded-lg px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors border ${
                              isActive
                                ? 'bg-[#0178a3] border-[#0178a3] text-white'
                                : 'border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white'
                            }`}
                          >
                            <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
                              <span className={`text-sm font-semibold whitespace-nowrap overflow-hidden text-ellipsis ${isActive ? 'text-white' : 'text-gray-200'}`}>
                                {item.name}
                              </span>
                              {item.position && (
                                <span className={`text-xs whitespace-nowrap overflow-hidden text-ellipsis ${
                                  isActive ? 'text-white/80' : item.type === 'PTP' ? 'text-[#22a7d3]' : 'text-gray-400'
                                }`}>
                                  {item.position}
                                </span>
                              )}
                              {item.type !== 'PTP' && item.code && (
                                <span className={`text-xs font-mono ${isActive ? 'text-white/80' : 'text-[#22a7d3]'}`}>{item.code}</span>
                              )}
                            </div>
                            {/* Function-type badge — cyan text only,
                                no background, so it reads as a label
                                rather than a pill. Matches the
                                secondary-text style used elsewhere
                                on chips. */}
                            <span className={`text-xs font-semibold flex-shrink-0 uppercase tracking-wider ${
                              isActive ? 'text-white' : 'text-[#22a7d3]'
                            }`}>
                              {item.type === 'Audio_IO' ? 'Audio I/O' : item.type}
                            </span>
                            {/* Active state is already obvious from
                                the cyan-fill + white text, so the
                                trailing checkmark we used to render
                                is redundant — removed. */}
                          </PickerItemDraggable>
                        )
                      })}
                    </div>
                  ))}
                  {Object.keys(groupedItems).length === 0 && (
                    <div className="text-sm text-gray-500 text-center py-8">No items found</div>
                  )}
                </div>
              </div>
            )}

            {/* Inspector footer */}
            {!pickerMode && isRequestMode && (
              <div className="px-[18px] py-4 border-t border-white/[0.06] flex flex-col gap-3 bg-[#232323]">
                {changedKeysCount > 0 && (
                  <div className="text-[11px] text-gray-400 text-center">
                    <strong className="text-[#f59e0b] font-bold">{changedKeysCount} key{changedKeysCount !== 1 ? 's' : ''}</strong> staged for change request
                  </div>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={saving || changedKeysCount === 0}
                  className="bg-[#22a7d3] text-white border-none py-3 px-3.5 rounded-[10px] font-bold text-xs cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#1d95bd] transition-colors"
                >
                  {saving ? 'Submitting...' : 'Submit changes'}
                </button>
              </div>
            )}
          </aside>
          </div>
        </div>
      </div>
      {/* Floating drag preview. Renders the SAME chip-style pill
          for both picker-chip drags and key→key drags so the visual
          language matches regardless of where the drag started. */}
      <DragOverlay dropAnimation={null}>
        {activeDragChip ? (
          <div className="pointer-events-none inline-flex items-center gap-2 rounded-md border border-[#0178a3] bg-[#0178a3] px-3 py-2 text-sm font-semibold text-white shadow-2xl">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{activeDragChip.name}</span>
            {activeDragChip.code && (
              <span className="font-mono text-xs text-white/70">{activeDragChip.code}</span>
            )}
          </div>
        ) : activeDragKeyChip ? (
          <div className="pointer-events-none inline-flex items-center gap-2 rounded-md border border-[#0178a3] bg-[#0178a3] px-3 py-2 text-sm font-semibold text-white shadow-2xl">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{activeDragKeyChip.name}</span>
            {activeDragKeyChip.code && (
              <span className="font-mono text-xs text-white/70">{activeDragKeyChip.code}</span>
            )}
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>

    </>
  )
}

/* ─── Custom select for the picker card top row.
   Native <select> shows its options as a browser-styled popup menu;
   we want a panel that matches our app's dropdown look (BrowseProject,
   Tabs mobile, etc.) — same width as the trigger, drops down below
   it, overlays the chip grid instead of pushing it down. */
function PickerSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Portal-rendered panel position. Tracked via getBoundingClientRect
  // so the panel can render into document.body and escape any
  // overflow-hidden ancestors (the picker card has several). Updated
  // on open + on scroll/resize while open.
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      // Click outside both the trigger AND the portal-rendered panel.
      if (ref.current && !ref.current.contains(target) && listRef.current && !listRef.current.contains(target)) setOpen(false)
      else if (ref.current && !ref.current.contains(target) && !listRef.current) setOpen(false)
    }
    function onFocusIn(e: FocusEvent) {
      const target = e.target as Node
      if (ref.current && !ref.current.contains(target) && listRef.current && !listRef.current.contains(target)) setOpen(false)
      else if (ref.current && !ref.current.contains(target) && !listRef.current) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', onMouseDown)
      document.addEventListener('focusin', onFocusIn)
    }
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [open])

  // Compute panel position when opening + on scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) { setPanelPos(null); return }
    function updatePos() {
      const btn = buttonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      setPanelPos({
        top: rect.bottom + 4, // 4px gap below trigger (mt-1)
        left: rect.left,
        width: rect.width,
      })
    }
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open])

  // When the dropdown opens, start the highlight on the active option
  // (or the first one) so an immediate Enter selects something sensible.
  useEffect(() => {
    if (!open) { setHighlight(-1); return }
    const activeIdx = options.findIndex((o) => o.value === value)
    setHighlight(activeIdx >= 0 ? activeIdx : 0)
  }, [open, options, value])

  // Keep the highlighted row visible during arrow-key navigation.
  useEffect(() => {
    if (!open || highlight < 0) return
    listRef.current?.querySelector<HTMLButtonElement>(`[data-idx="${highlight}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      if (options.length === 0) return
      setHighlight((h) => (h + 1 >= options.length ? 0 : h + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      if (options.length === 0) return
      setHighlight((h) => (h <= 0 ? options.length - 1 : h - 1))
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (!open) {
        // Opens the menu — same as clicking the trigger.
        e.preventDefault()
        setOpen(true)
        return
      }
      // Open + Enter → lock in the highlighted option, close menu, but
      // don't propagate so any surrounding form Enter handler doesn't fire.
      if (highlight >= 0 && highlight < options.length) {
        e.preventDefault()
        e.stopPropagation()
        onChange(options[highlight].value)
        setOpen(false)
      }
      return
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }

  const current = options.find((o) => o.value === value) ?? options[0]

  return (
    <div ref={ref} className="relative w-full" onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        // Close-on-focus-out is handled by the focusin listener above.
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-4 py-3 text-left text-sm text-gray-200 outline-none transition-colors ${
          open ? 'border-[#22a7d3]/50 bg-white/[0.04]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white'
        }`}
      >
        <span className="truncate">{current?.label}</span>
        <svg
          className={`size-3 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
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
      {open && panelPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={listRef}
          className="z-[1000] max-h-[260px] overflow-y-auto rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl"
          style={{
            position: 'fixed',
            top: panelPos.top,
            left: panelPos.left,
            width: panelPos.width,
          }}
        >
          {options.map((o, idx) => {
            const isActive = o.value === value
            const isHighlight = idx === highlight
            const stateClass = isActive
              ? 'bg-[#0178a3] text-white'
              : isHighlight
                ? 'bg-white/[0.08] text-white'
                : 'text-gray-200 hover:bg-white/[0.06] hover:text-white'
            return (
              <button
                key={o.value}
                type="button"
                data-idx={idx}
                tabIndex={-1}
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-4 py-3 text-left text-sm font-medium transition-colors ${stateClass}`}
              >
                <span className="truncate">{o.label}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}

/* ─── Tile component: combines useDraggable + useDroppable on a single
   chassis key. We render an outer droppable wrapper and let the same
   element act as the draggable handle when the key isn't empty. The two
   refs are merged. ─── */
function PanelKeyTile({
  id,
  canDrag,
  canDrop,
  buildClassName,
  flashStyle,
  onClick,
  children,
}: {
  id: string
  canDrag: boolean
  canDrop: boolean
  buildClassName: (isOver: boolean) => string
  flashStyle: React.CSSProperties | undefined
  onClick: () => void
  children: React.ReactNode
}) {
  const dragData: KeyDragData = { kind: 'key', sourceId: id }
  const draggable = useDraggable({ id: `key-${id}`, data: dragData, disabled: !canDrag })
  const droppable = useDroppable({ id: `drop-${id}`, data: { kind: 'key', keyId: id }, disabled: !canDrop })

  // Merge the two refs — both hooks need to attach to the same DOM node.
  const setRef = (node: HTMLDivElement | null) => {
    draggable.setNodeRef(node)
    droppable.setNodeRef(node)
  }

  // No touch-action override — sensors are press-and-hold (500ms),
  // so the browser is free to handle quick taps as clicks and quick
  // swipes as native scroll. Hold still on a key for half a second
  // to start a drag.
  // Inline `scale` CSS property when being dragged over — Tailwind v4's
  // class-generated `scale-125` may not include this exact size on
  // initial JIT scan and the inline style guarantees the visual cue
  // applies. CSS `scale` is independent of `transform: translate`, so
  // the selected-state's translate-y still works alongside this.
  const inlineStyle: React.CSSProperties = {
    ...flashStyle,
    ...(droppable.isOver ? { scale: '1.25', zIndex: 10 } : {}),
  }
  return (
    <div
      ref={setRef}
      className={buildClassName(droppable.isOver)}
      style={inlineStyle}
      onClick={onClick}
      {...(canDrag ? draggable.listeners : {})}
      {...(canDrag ? draggable.attributes : {})}
    >
      {children}
    </div>
  )
}

/* ─── Picker draggable wrapper. Same idea but draggable-only. ─── */
function PickerItemDraggable({
  item,
  canDrag,
  isActive,
  className,
  onClick,
  children,
}: {
  item: PickerItem
  canDrag: boolean
  isActive: boolean
  className: string
  onClick: () => void
  children: React.ReactNode
}) {
  const dragData: PicklistDragData = { kind: 'picklist', item }
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `pick-${item.type}-${item.id}`,
    data: dragData,
    disabled: !canDrag,
  })
  void isActive
  const style = isDragging ? { opacity: 0.4 } : undefined
  // Same rationale as PanelKeyTile — sensors use a 500ms hold so
  // we don't need touch-action overrides; quick swipes still scroll
  // natively, only a held press starts a drag.
  return (
    <div
      ref={setNodeRef}
      className={className}
      style={style}
      onClick={onClick}
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
    >
      {children}
    </div>
  )
}

/**
 * Format every key on the panel as a clipboard-friendly plain-text dump.
 * Sections: panel header, MAIN page, SHIFT page (if applicable), and each
 * EXPANSION 1..N. Empty keys are listed as "—" so positions stay visible.
 */
function formatKeysForClipboard(
  equipment: { name: string | null; hardwareType: string | null },
  member: { firstName: string; lastName: string; position: string | null } | null,
  keys: Array<{
    keyIndex: number
    page: string
    expansion: number
    pickListItemName: string | null
    pickListItemType: string | null
    triggerMode: string
  }>,
): string {
  const lines: string[] = []
  const memberName = member ? `${member.firstName} ${member.lastName}`.trim() : ''
  const headerBits = [
    equipment.name || 'Panel',
    equipment.hardwareType,
    memberName,
    member?.position,
  ].filter(Boolean)
  lines.push(headerBits.join(' · '))
  lines.push('')

  // Group keys by (expansion, page).
  const expansions = Array.from(new Set(keys.map((k) => k.expansion))).sort((a, b) => a - b)
  for (const exp of expansions) {
    const expKeys = keys.filter((k) => k.expansion === exp)
    const pages = Array.from(new Set(expKeys.map((k) => k.page)))
    // Render main page first, then shift if present.
    const orderedPages = ['main', 'shift'].filter((p) => pages.includes(p))
    for (const page of orderedPages) {
      const pageKeys = expKeys
        .filter((k) => k.page === page)
        .sort((a, b) => a.keyIndex - b.keyIndex)
      if (pageKeys.length === 0) continue
      const sectionLabel = exp === 0
        ? page === 'main' ? 'MAIN' : 'SHIFT'
        : `EXPANSION ${exp}${page === 'shift' ? ' (SHIFT)' : ''}`
      lines.push(sectionLabel)
      for (const k of pageKeys) {
        const display = k.pickListItemName
          ? `${k.pickListItemName}${k.pickListItemType ? ` · ${k.pickListItemType}` : ''}${k.triggerMode && k.triggerMode !== 'latch' ? ` · ${k.triggerMode}` : ''}`
          : '—'
        lines.push(`K${k.keyIndex + 1}: ${display}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n').trimEnd() + '\n'
}

const PANEL_CATS = ['panels', 'hardwire_bp', 'wireless_bp']
const CAT_SHORT: Record<string, string> = {
  panels: 'Panel',
  wireless_bp: 'WL BP',
  hardwire_bp: 'HW BP',
  switches: 'Switch',
  antennas: 'Antenna',
  audio: 'Audio',
  // Radios live in their own table but surface here as sibling chips
  // (non-tappable for now — phase 4 will add the zone-channel view).
  radio: 'Radio',
}

/**
 * Browse-mode header bar: project switcher + user switcher + prev/next.
 * Same look as the controls on /my-equipment so the experience flows.
 */
/**
 * Project picker for browse mode. Standalone so the parent layout can place
 * it independently of the user switcher (e.g. far right on desktop).
 */
export function BrowseProjectDropdown({
  project,
  browseProjects,
  className = '',
}: {
  project: { id: number; name: string }
  browseProjects: Array<{ id: number; name: string; firstEquipmentId: number | null }>
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      inputRef.current?.focus()
    }
  }, [open])

  const filtered = query.trim()
    ? browseProjects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : browseProjects

  function navigateToProject(nextId: number) {
    if (nextId === project.id) return
    // Skip the /my-equipment redirect by going straight to the
    // target project's panel route. The first panel-category
    // equipment id is preloaded server-side on each browseProjects
    // entry; if a project has no panels the dropdown still falls
    // back to /my-equipment so the empty-state can render there.
    const target = browseProjects.find((p) => p.id === nextId)
    if (target?.firstEquipmentId != null) {
      router.push(`/projects/${nextId}/panel/${target.firstEquipmentId}?from=my-equipment`)
    } else {
      router.push(`/my-equipment?project=${nextId}`)
    }
  }

  return (
    // Wrapper + button classes mirror the shared ProjectSwitcher in
    // src/app/project-dashboard.tsx so the Panel Studio dropdown scales
    // identically with project-name length (min-w 280, grows with content)
    // instead of being clamped at exactly 280px.
    <div ref={ref} className={`relative w-full sm:inline-block sm:w-auto ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2.5 rounded-lg border-2 bg-[#202020] px-3.5 py-2 text-sm font-medium text-white transition-colors sm:min-w-[280px] ${
          open ? 'border-[#0178a3]' : 'border-white/10 hover:border-white/20'
        }`}
      >
        <span className="truncate">{project.name}</span>
        <svg className={`size-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 8 10 13 15 8" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 flex max-h-[320px] flex-col rounded-lg border border-white/10 bg-[#2a2a2a] shadow-2xl">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered.length > 0) {
                e.preventDefault()
                setOpen(false)
                navigateToProject(filtered[0].id)
              } else if (e.key === 'Escape') {
                setOpen(false)
              }
            }}
            placeholder="Search shows…"
            className="m-1 rounded-md border border-white/10 bg-[#202020] px-2.5 py-1.5 text-[12px] text-gray-200 placeholder:text-gray-500 focus:border-[#22a7d3]/50 focus:outline-none"
          />
          <div className="overflow-y-auto p-1 pt-0">
            {filtered.map((p) => {
              const isActive = p.id === project.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setOpen(false); navigateToProject(p.id) }}
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                    isActive ? 'bg-[#0178a3]' : 'hover:bg-white/[0.06]'
                  }`}
                >
                  <span className={`text-[12px] font-medium ${isActive ? 'text-white' : 'text-gray-200'}`}>{p.name}</span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-gray-500">No shows match</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * User switcher for browse mode — prev / next chevrons flanking a search-
 * filterable dropdown. Standalone so the parent layout can place it (e.g.
 * centered between the title and the project picker on desktop).
 */
export function BrowseMemberSwitcher({
  project,
  currentEquipmentId,
  browseMembers,
  className = '',
}: {
  project: { id: number }
  /** ID of the equipment the panel studio is currently showing — used
   *  to find the matching dropdown row and drive prev/next navigation. */
  currentEquipmentId: number
  browseMembers: Array<{
    id: number // entry id = equipmentId
    memberId: number
    firstName: string
    lastName: string
    position: string | null
    displayName: string
    equipmentId: number | null
    equipmentName: string | null
  }>
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      inputRef.current?.focus()
    }
  }, [open])

  const filtered = query.trim()
    ? browseMembers.filter((m) => {
        const q = query.trim().toLowerCase()
        return (
          m.displayName.toLowerCase().includes(q) ||
          (m.position ?? '').toLowerCase().includes(q) ||
          (m.equipmentName ?? '').toLowerCase().includes(q)
        )
      })
    : browseMembers

  // Each entry's id IS the equipmentId, so match against the panel
  // studio's currently-showing equipment to find which row is "active".
  const currentEntry = browseMembers.find((m) => m.id === currentEquipmentId) ?? null
  // ID first (left of name) — admins read the panel ID first to know
  // which one they're on. Then name, then optional position.
  const memberLabel = currentEntry
    ? [currentEntry.equipmentName, currentEntry.displayName, currentEntry.position]
        .filter(Boolean)
        .join(' · ')
    : '—'
  const currentMemberIndex = currentEntry
    ? browseMembers.findIndex((m) => m.id === currentEntry.id)
    : -1

  function navigateToEntry(entryId: number) {
    const target = browseMembers.find((m) => m.id === entryId)
    if (!target || target.equipmentId == null) return
    router.push(`/projects/${project.id}/panel/${target.equipmentId}?from=my-equipment`)
  }

  function jumpByOffset(offset: number) {
    if (browseMembers.length === 0 || currentMemberIndex < 0) return
    const wrapped = ((currentMemberIndex + offset) % browseMembers.length + browseMembers.length) % browseMembers.length
    navigateToEntry(browseMembers[wrapped].id)
  }

  return (
    <div ref={ref} className={`flex w-full items-center gap-1 sm:w-auto ${className}`}>
      {/* Prev / Next steppers — hidden on mobile so the dropdown
          itself can be full-width. The dropdown lets you jump to
          any user anyway, so the steppers are a desktop nicety. */}
      <button
        type="button"
        onClick={() => jumpByOffset(-1)}
        aria-label="Previous user"
        className="hidden sm:flex h-[38px] w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white hover:text-white"
      >
        <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
      </button>
      <div className="relative flex-1 sm:w-[280px] sm:flex-initial">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`flex w-full items-center justify-between gap-2.5 rounded-lg border-2 bg-[#202020] px-3.5 py-2 text-sm font-medium text-white transition-colors ${
            open ? 'border-[#0178a3]' : 'border-white/10 hover:border-white/20'
          }`}
        >
          <span className="truncate">{memberLabel}</span>
          <svg className={`size-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 8 10 13 15 8" /></svg>
        </button>
        {open && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 flex max-h-[360px] flex-col rounded-lg border border-white/10 bg-[#2a2a2a] shadow-2xl">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const first = filtered.find((m) => m.equipmentId != null)
                  if (first) {
                    e.preventDefault()
                    setOpen(false)
                    navigateToEntry(first.id)
                  }
                } else if (e.key === 'Escape') {
                  setOpen(false)
                }
              }}
              placeholder="Search users…"
              className="m-1 rounded-md border border-white/10 bg-[#202020] px-2.5 py-1.5 text-[12px] text-gray-200 placeholder:text-gray-500 focus:border-[#22a7d3]/50 focus:outline-none"
            />
            <div className="overflow-y-auto p-1 pt-0">
              {filtered.map((m) => {
                const isActive = currentEntry?.id === m.id
                // ID left of name, then optional position. Matches the
                // trigger button label so the dropdown rows read the
                // same way.
                const label = [m.equipmentName, m.displayName, m.position].filter(Boolean).join(' · ')
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { setOpen(false); navigateToEntry(m.id) }}
                    disabled={m.equipmentId == null}
                    className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors disabled:opacity-40 ${
                      isActive ? 'bg-[#0178a3]' : 'hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className={`text-[12px] font-medium ${isActive ? 'text-white' : 'text-gray-200'}`}>{label}</span>
                  </button>
                )
              })}
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-gray-500">No users match</div>
              )}
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => jumpByOffset(1)}
        aria-label="Next user"
        className="hidden sm:flex h-[38px] w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white hover:text-white"
      >
        <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
      </button>
    </div>
  )
}

/**
 * Horizontal row of the current member's other gear on this project. Click
 * a card to navigate to that equipment's page (panel studio for panels,
 * which currently is the only category that renders meaningful keys).
 */
export function SiblingGearRow({
  gear,
  currentEquipmentId,
  projectId,
}: {
  gear: Array<{ id: number; name: string; category: string; hardwareType: string | null }>
  currentEquipmentId: number
  projectId: number
}) {
  const router = useRouter()
  return (
    <div className="flex-shrink-0 mx-auto w-full max-w-7xl px-4 pt-2 sm:px-6 lg:px-8">
      <div className="flex flex-wrap gap-2">
        {gear.map((g) => {
          const isActive = g.id === currentEquipmentId
          const isPanel = PANEL_CATS.includes(g.category)
          // Radios surface with a negative synthetic id (see
          // page.tsx siblingGear builder) so we never collide with
          // equipment ids. Convert back when routing.
          const isRadio = g.category === 'radio'
          const radioId = isRadio ? Math.abs(g.id) : null
          const clickable = (!isActive && isPanel) || isRadio
          const catLabel = CAT_SHORT[g.category] ?? g.category
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => {
                if (!isActive && isPanel) {
                  router.push(`/projects/${projectId}/panel/${g.id}?from=my-equipment`)
                } else if (isRadio && radioId != null) {
                  // Stay on the panel-studio surface — the route reads
                  // ?radio=<id> from search params and swaps the chassis
                  // body for the zone list. Same shell (project + member
                  // dropdowns, prev/next, sibling-gear row) carries over.
                  router.push(
                    `${window.location.pathname}?from=my-equipment&radio=${radioId}`,
                  )
                }
              }}
              disabled={!clickable}
              className={`rounded-lg border px-3 py-1.5 text-left text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isActive
                  ? 'border-[#22a7d3] bg-[#22a7d3]/10 text-white'
                  : 'border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white'
              }`}
            >
              <div className={`font-mono font-semibold ${isActive ? 'text-[#22a7d3]' : 'text-gray-400'}`}>{g.name}</div>
              <div className="text-[10px] text-gray-500">
                {catLabel}
                {g.hardwareType ? ` · ${g.hardwareType}` : ''}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
