'use client'

import { useState, useEffect, useCallback, useRef, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeftIcon } from '@heroicons/react/24/outline'
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
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/button'
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
  browseProjects?: Array<{ id: number; name: string }>
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
  const [keys, setKeys] = useState<KeyState[]>(() => initializeKeys(initialPanelKeys, keyCount))
  const [clipboard, setClipboard] = useState<{ pickListItemId: number | null; pickListItemName: string | null; pickListItemType: string | null; triggerMode: string; talkMode: string } | null>(null)
  const [flashingKey, setFlashingKey] = useState<{ id: string; color: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
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
  type PanelClipboard = { sourceLabel: string; entries: PanelClipboardEntry[] }
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
      return `${keysFp}||res:${resFp}`
    },
    [initialPanelKeys, recentResolutions]
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
    setKeys(initializeKeys(initialPanelKeys, keyCount))

    // New resolutions since the last sync — decide toast(s).
    const newResolutions = recentResolutions.filter(
      (r) => !seenResolutionIdsRef.current.has(r.id),
    )
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

  // Remember the last project + member the admin browsed to so the nav
  // "My Equipment" link returns them right where they left off. Cookies are
  // server-readable, so /my-equipment can read them on next entry without a
  // round-trip through the URL.
  useEffect(() => {
    if (!isBrowseMode || !member) return
    const maxAge = 60 * 60 * 24 * 30 // 30 days
    document.cookie = `lastBrowseProject=${project.id};path=/;max-age=${maxAge}`
    document.cookie = `lastBrowseMember=${member.id};path=/;max-age=${maxAge}`
    // Also write the shared `selectedProject` cookie so Dashboard / Tasks /
    // Admin land on the same project the admin was just browsing here.
    document.cookie = `selectedProject=${project.id};path=/;max-age=${60 * 60 * 24 * 365}`
  }, [isBrowseMode, project.id, member])

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

  // Measures the chassis width so the header layout can switch:
  // wide chassis → identity left / legend+buttons right on a single
  // row (justify-between). Narrow chassis (e.g. a 2- or 4-key panel)
  // → stack the two groups into their own centered rows so the
  // header doesn't run wider than the chassis below it.
  const [chassisWidth, setChassisWidth] = useState<number | null>(null)
  useEffect(() => {
    const el = chassisRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
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
  const stackHeader = chassisWidth !== null && chassisWidth < 720

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
    const payload: PanelClipboard = { sourceLabel, entries }
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

  function handlePastePanel() {
    if (!panelClipboard) return
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
        const result = await saveDraftKeys(member.id, currentUserId, changedKeys)
        if (result.error) {
          showToast('error', result.error)
        } else {
          showToast('success', 'Draft saved')
        }
      } else {
        const result = await saveKeys(member.id, changedKeys)
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

      const draftResult = await saveDraftKeys(member.id, currentUserId, changedKeys)
      if (draftResult.error) {
        showToast('error', draftResult.error)
        setSaving(false)
        return
      }

      const result = await submitChanges(member.id, project.id, currentUserId)
      if (result.error) {
        showToast('error', result.error)
      } else {
        showToast('success', 'Changes submitted for approval')
        // Mark changed keys as submitted
        setKeys((prev) =>
          prev.map((k) => (k.status === 'changed' ? { ...k, status: 'submitted' } : k))
        )
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
      const result = await addExpansion(member.id, equipment.hardwareType)
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
      const result = await removeExpansion(member.id, expansionCount)
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

  function handleDndStart(event: DragStartEvent) {
    if (!canEditKeys) return
    const data = event.active.data.current as DragData | undefined
    if (!data) return
    if (data.kind === 'key') {
      setDragSourceId(data.sourceId)
      // Bypass selectKey() — its tap-to-toggle logic closes the
      // picker when the dragged key was already selected, which
      // makes the picker card flicker in/out during a touch drag
      // on iPad. Set state directly so the picker stays open
      // throughout the drag.
      setSelectedKeyId(data.sourceId)
      setInspectorOpen(true)
      if (canEditKeys) setPickerMode(true)
      setActiveDragChip(null)
    } else if (data.kind === 'picklist') {
      setDragSourceId(null)
      setActiveDragChip(data.item)
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
  }

  function handleDndCancel() {
    setDragSourceId(null)
    setActiveDragChip(null)
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
            {hasReviewChange ? (
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
          {/* Trigger mode indicator (hide in review mode) */}
          {!isReviewMode && !isEmpty && keyState.triggerMode !== 'latch' && (
            <div className="absolute bottom-1 right-1.5 text-[9px] font-extrabold text-[#f59e0b] opacity-85 uppercase">
              {triggerLabel(keyState.triggerMode)}
            </div>
          )}
          {!isReviewMode && !isEmpty && keyState.triggerMode === 'latch' && (
            <div className="absolute bottom-1 right-1.5 text-[9px] font-extrabold text-[#f59e0b] opacity-85 uppercase">
              L
            </div>
          )}
          {/* Talk-mode indicator on the bottom-left of the key:
              TL for Talk + Listen (default), T for Talk-only,
              L for Listen-only. Cyan to set it apart from the
              amber trigger-mode label on the bottom-right. */}
          {!isReviewMode && !isEmpty && (
            <div className="absolute bottom-1 left-1.5 text-[9px] font-extrabold text-[#22a7d3] opacity-85 uppercase">
              {keyState.talkMode === 't' ? 'T' : keyState.talkMode === 'l' ? 'L' : 'TL'}
            </div>
          )}
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
    [selectedKeyId, dragSourceId, flashingKey, canEditKeys, isRequestMode, isReviewMode, reviewChangesMap, rejectedKeyIds, keys]
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
    <AppShell userName={userName} isAdmin={isAdminGlobal} isUserOnly={isUserOnly} showMyEquipment={isCrew}>
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
        modifiers={activeDragChip ? [snapCenterToCursor] : []}
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
      <div className="flex flex-col" style={{ height: 'calc(100dvh - 56px)' }}>
        <div className="flex flex-1 overflow-hidden relative min-h-0">

          {/* ─── Editor workspace ─── */}
          <div className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative ${inspectorOpen ? 'lg:pr-0' : ''}`}>
            {/* Back link — pinned to the very top of the workspace.
                User-only accounts can't access the project page (proxy
                blocks it), so route them back to My Equipment instead. */}
            {!isBrowseMode && (
              <div className="flex-shrink-0 mx-auto w-full max-w-7xl flex flex-wrap items-center justify-between gap-3 pt-5 px-4 sm:px-6 lg:px-8">
                {/* The back button is only useful when the admin/manager came
                    in from a project tab or an admin review. User-only role
                    treats panel studio as the entire My Equipment experience,
                    so the back button would just reload the same page. */}
                {!isUserOnly && (
                  <button
                    onClick={() => {
                      const dest = isReviewMode ? '/admin' : `/projects/${project.id}`
                      router.push(dest)
                    }}
                    className="inline-flex items-center gap-1 text-sm text-gray-400 transition-colors hover:text-white"
                  >
                    <ChevronLeftIcon className="size-4" />
                    <span>{isReviewMode ? 'Tasks' : 'Project'}</span>
                  </button>
                )}
              </div>
            )}

            {/* Browse-mode header bar.
                Mobile: title row, then project full-width, then user
                full-width — three stacked rows.
                Desktop: 3-column grid — title left, user dropdown centered,
                project dropdown far right. */}
            {isBrowseMode && browseProjects && browseMembers && (
              <div className="flex-shrink-0 mx-auto w-full max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
                {/* Mobile layout — divider sits directly under the
                    title (matches PageHeader's showMobileDivider
                    pattern) so the line reads as "under the page
                    name" rather than below the whole stack. */}
                <div className="flex flex-col gap-2 sm:hidden">
                  <h1 className="text-2xl font-bold tracking-tight text-white">
                    My Equipment
                  </h1>
                  <div className="w-full border-b border-white/20" />
                  <BrowseProjectDropdown project={project} browseProjects={browseProjects} />
                  <div className="pt-2">
                    <BrowseMemberSwitcher project={project} currentEquipmentId={equipment.id} browseMembers={browseMembers} />
                  </div>
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
            {!(pickerMode && canEditKeys) && (
              <div className="flex-shrink-0 mx-auto hidden w-full max-w-7xl px-4 pt-4 sm:block sm:px-6 lg:px-8">
                <div className="border-b border-white/20" />
              </div>
            )}

            {/* Sibling-gear card row — every piece of equipment for the
                current member on this project. Click to switch panels
                without leaving browse mode. */}
            {isBrowseMode && siblingGear && siblingGear.length > 1 && (
              <SiblingGearRow
                gear={siblingGear}
                currentEquipmentId={equipment.id}
                projectId={project.id}
              />
            )}

            <div className={`relative flex flex-col items-center flex-1 min-h-0 ${pickerMode && canEditKeys ? 'justify-center sm:justify-start' : 'justify-center'}`}>

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
                    // area. Outer is `mx-auto max-w-7xl px-4 sm:px-6
                    // lg:px-8` — same gutter math as every other page
                    // header / content section, so the picker card's
                    // left and right edges sit at the standard 32px
                    // page margin on desktop. Vertical cap keeps the
                    // chassis below visible: max-h-[min(35vh,280px)]
                    // kicks the smaller value in on short laptop
                    // viewports so a 6-key panel still fits without
                    // forcing a scroll.
                    className="flex max-h-[min(35vh,280px)] min-h-0 w-full flex-1 flex-col border-b border-white/10 pb-4"
                  >
                    {/* Top row: 3 controls + search + close — separated
                        from the chip grid below by the same border style
                        as the divider between the two chip columns. */}
                    <div className="flex flex-wrap items-end gap-3 border-b border-white/10 pb-3.5">
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Function Type</div>
                        <PickerSelect
                          value={pickerFilter}
                          onChange={setPickerFilter}
                          options={filterTypes.map((t) => ({
                            value: t,
                            label: t === 'All' ? 'All function types' : t === 'Audio' ? 'Audio I/O' : t,
                          }))}
                        />
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Trigger Mode</div>
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

                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Talk Keys</div>
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

                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">&nbsp;</div>
                        <button
                          type="button"
                          onClick={() => {
                            // Haptic blip on supported devices (iOS
                            // Safari has no Vibration API yet, but
                            // it's a no-op there). Fires regardless
                            // of whether the key was already empty —
                            // the user's tapped a button and should
                            // feel something.
                            try { navigator.vibrate?.(15) } catch {}
                            if (selectedKeyId) clearKey(selectedKeyId)
                          }}
                          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-3.5 py-2 text-sm font-semibold text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04]"
                        >
                          {selectedKey?.pickListItemId ? 'Clear Key' : 'Unassigned'}
                        </button>
                      </div>

                      <div className="min-w-[200px] flex-1">
                        <input
                          type="text"
                          placeholder="Search by name or code..."
                          value={pickerSearch}
                          onChange={(e) => setPickerSearch(e.target.value)}
                          className="block w-full rounded-lg border border-white/10 px-3.5 py-2 text-sm text-gray-200 outline-none transition-colors placeholder:text-gray-200 hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
                          autoCapitalize="off"
                          autoCorrect="off"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>

                      {/* Close X — top-right of the card. Closes the
                          inspector too so we don't fall back into the
                          old detail-view modal on desktop. */}
                      <button
                        type="button"
                        onClick={() => { closeInspector() }}
                        aria-label="Close picker"
                        className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04]"
                      >
                        <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* Items as tab-style chips, split into two columns:
                        left = everything except PTP (CONF, IFB, Audio,
                        GRP) grouped by type, right = PTP (panels &
                        beltpacks). Each column scrolls independently
                        so a long PTP list doesn't push the rest off
                        screen. min-h-0 + flex-1 lets the whole grid
                        auto-shrink so the chassis below stays in view
                        when expansions are active. */}
                    {(() => {
                      const renderChip = (item: PickerItem) => {
                        const isActive = selectedKey?.pickListItemId === item.id
                        return (
                          <PickerItemDraggable
                            key={`${item.type}-${item.id}`}
                            item={item}
                            canDrag={canEditKeys}
                            isActive={isActive}
                            onClick={() => selectedKeyId && assignPickerItem(selectedKeyId, item)}
                            className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-[colors,transform] active:scale-95 ${
                              isActive
                                ? 'border-[#0178a3] bg-[#0178a3] text-white'
                                : 'border-white/10 bg-[#202020] text-gray-300 hover:border-white/20 hover:bg-[#2a2a2a] hover:text-white'
                            }`}
                          >
                            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
                            {/* PTP chips: show the member's position
                                in cyan so admins can pick the right
                                John Doe by role at a glance. The code
                                field is hidden for PTP because the
                                position already serves that "extra
                                disambiguator" role and double labels
                                feel redundant. */}
                            {item.type === 'PTP' && item.position && (
                              <span className={`overflow-hidden text-ellipsis whitespace-nowrap text-[10px] ${isActive ? 'text-white/85' : 'text-[#22a7d3]'}`}>
                                {item.position}
                              </span>
                            )}
                            {item.type !== 'PTP' && item.code && (
                              // Non-PTP code (CONF / IFB / GRP / Audio
                              // I/O id) gets the same cyan treatment as
                              // PTP's position so the disambiguator
                              // text reads consistently across all
                              // function types in the picker.
                              <span className={`font-mono text-[10px] ${isActive ? 'text-white/85' : 'text-[#22a7d3]'}`}>{item.code}</span>
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
                          <div className="flex flex-wrap gap-1.5">
                            {items.map(renderChip)}
                          </div>
                        </div>
                      )
                      const otherEntries = Object.entries(groupedItems).filter(([t]) => t !== 'PTP')
                      const ptpItems = groupedItems.PTP ?? []
                      if (Object.keys(groupedItems).length === 0) {
                        return <div className="py-8 text-center text-sm text-gray-500">No items found</div>
                      }
                      return (
                        <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-hidden pt-3.5">
                          {/* Each column wrapped in VerticalScroller so
                              up/down chevrons appear on the right edge
                              when there are more chips than fit. Same
                              chevron styling as ChipScroller's left/
                              right buttons elsewhere in the app. */}
                          <VerticalScroller
                            className="min-h-0"
                            scrollClassName="flex h-full flex-col gap-3 overflow-y-auto pr-9"
                            ariaLabel="functions"
                          >
                            {otherEntries.length === 0 ? (
                              <div className="py-4 text-center text-xs text-gray-500">Nothing in this filter</div>
                            ) : (
                              otherEntries.map(([type, items]) => renderGroup(type, items))
                            )}
                          </VerticalScroller>
                          <VerticalScroller
                            className="min-h-0 border-l border-white/10 pl-4"
                            scrollClassName="flex h-full flex-col gap-3 overflow-y-auto pr-9"
                            ariaLabel="point-to-point list"
                          >
                            {ptpItems.length === 0 ? (
                              <div className="py-4 text-center text-xs text-gray-500">No PTP in this filter</div>
                            ) : (
                              renderGroup('PTP', ptpItems)
                            )}
                          </VerticalScroller>
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
              <div className="w-full flex-shrink-0 pt-2 pb-2 lg:pt-3 lg:pb-3">
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
                  {/* Legend + expansion — visible from sm+ (so it
                      sits to the right of the identity strip in
                      landscape phone too, not just desktop). */}
                  <div className="hidden flex-wrap items-center gap-x-2 gap-y-1 sm:flex">
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                      <span className="w-[9px] h-[9px] rounded-sm bg-[#10b981] shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
                      Assigned
                    </div>
                    {isRequestMode && (
                      <>
                        <span className="text-xs text-[#3a3a3a]">&middot;</span>
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
                    <span className="text-xs text-[#3a3a3a]">&middot;</span>
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                      <span className="w-[9px] h-[9px] rounded-sm border border-dashed border-gray-600 bg-transparent" />
                      Unassigned
                    </div>
                    {canManageExpansions && isExpandable && (
                      <>
                        <span className="text-xs text-[#3a3a3a]">&middot;</span>
                        <div className="inline-flex items-center gap-2 text-xs text-gray-300">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Expansions</span>
                          <span className="font-semibold text-white">{expansionCount}</span>
                          <div className="inline-flex gap-1.5">
                            {expansionCount > 0 && (
                              <button
                                onClick={handleRemoveExpansion}
                                disabled={saving}
                                className="w-7 h-7 rounded-lg border border-white/[0.14] bg-transparent text-red-500 text-lg font-bold flex items-center justify-center hover:bg-red-500/[0.08] hover:border-red-500/40 disabled:opacity-50"
                              >
                                &minus;
                              </button>
                            )}
                            {expansionCount < 6 && (
                              <button
                                onClick={handleAddExpansion}
                                disabled={saving}
                                className="w-7 h-7 rounded-lg border border-white/[0.14] bg-transparent text-[#22a7d3] text-lg font-bold flex items-center justify-center hover:bg-[rgba(34,167,211,0.08)] hover:border-[rgba(34,167,211,0.4)] disabled:opacity-50"
                              >
                                +
                              </button>
                            )}
                          </div>
                        </div>
                      </>
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
                            className="shrink-0 rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04]"
                          >
                            Copy
                          </button>
                          {panelClipboard && panelClipboard.entries.length > 0 && (
                            <button
                              type="button"
                              onClick={handlePastePanel}
                              title={`Paste from ${panelClipboard.sourceLabel}`}
                              className="shrink-0 rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04]"
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
                          className="shrink-0 rounded-md bg-[#0178a3] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                </div>
              </div>

              {/* ─── Mobile-only legend + expansion row ───
                  Sits BELOW the user-name strip (between identity and
                  the chassis) on mobile so the deploy-status legend
                  and expansion controls are quick to scan without
                  pushing the bigger identity text down. Hidden on
                  desktop (lg+) — same content already lives in the
                  studio header's right group there. */}
              <div className="flex w-full flex-shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 pb-2 sm:hidden">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                  <span className="w-[9px] h-[9px] rounded-sm bg-[#10b981] shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
                  Assigned
                </div>
                {isRequestMode && (
                  <>
                    <span className="text-xs text-[#3a3a3a]">&middot;</span>
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
                <span className="text-xs text-[#3a3a3a]">&middot;</span>
                <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                  <span className="w-[9px] h-[9px] rounded-sm border border-dashed border-gray-600 bg-transparent" />
                  Unassigned
                </div>
                {canManageExpansions && isExpandable && (
                  <>
                    <span className="text-xs text-[#3a3a3a]">&middot;</span>
                    <div className="inline-flex items-center gap-2 text-xs text-gray-300">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Expansions</span>
                      <span className="font-semibold text-white">{expansionCount}</span>
                      <div className="inline-flex gap-1.5">
                        {expansionCount > 0 && (
                          <button
                            onClick={handleRemoveExpansion}
                            disabled={saving}
                            className="w-7 h-7 rounded-lg border border-white/[0.14] bg-transparent text-red-500 text-lg font-bold flex items-center justify-center hover:bg-red-500/[0.08] hover:border-red-500/40 disabled:opacity-50"
                          >
                            &minus;
                          </button>
                        )}
                        {expansionCount < 6 && (
                          <button
                            onClick={handleAddExpansion}
                            disabled={saving}
                            className="w-7 h-7 rounded-lg border border-white/[0.14] bg-transparent text-[#22a7d3] text-lg font-bold flex items-center justify-center hover:bg-[rgba(34,167,211,0.08)] hover:border-[rgba(34,167,211,0.4)] disabled:opacity-50"
                          >
                            +
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* ─── Scrollable panel content ─── */}
              <div
                className={`flex-[0_1_auto] min-h-0 w-full overflow-auto p-4 sm:px-6 lg:p-5 lg:px-8 flex transition-[padding-right] duration-300 ${inspectorOpen && !(pickerMode && canEditKeys) ? 'xl:pr-[420px] 2xl:pr-10' : ''}`}
              >
                <div className="min-w-min mx-auto" ref={chassisRef}>
                  {/* Single chassis card containing expansions + main panel */}
                  <div className="relative bg-[#2a2a2a] border border-white/[0.06] rounded-[14px] p-8 flex flex-col gap-4 items-center">
                    {/* Hardware type + key count, top-right corner of the
                        chassis card itself — engraved silkscreen look so
                        it sits on the gear like a manufacturer label,
                        matching the look used for the expansion number. */}
                    <div
                      className="pointer-events-none absolute right-4 top-3 text-[10px] font-bold uppercase tracking-[0.18em] tabular-nums leading-none"
                      style={{
                        // Cyan brand colour at low alpha so the label
                        // reads like a faintly tinted silkscreen on
                        // the chassis. Same engraved shadow recipe as
                        // before keeps the "carved into the surface"
                        // feel.
                        color: 'rgba(34,167,211,0.55)',
                        textShadow: [
                          '0 -1px 0 rgba(255,255,255,0.06)',
                          '0 -2px 2px rgba(255,255,255,0.03)',
                          '0 1px 0 rgba(0,0,0,0.6)',
                          '0 2px 4px rgba(0,0,0,0.4)',
                        ].join(', '),
                      }}
                    >
                      {(equipment.hardwareType || 'Unknown')} · {keyCount}-Key
                    </div>
                    {/* Expansion rows (rendered on top, reversed so newest is at top).
                        Number sits to the LEFT of the keys, vertically centered
                        against the panel block, with an engraved silkscreen-style
                        look — dark text on the dark chassis surface plus a hairline
                        highlight at the bottom edge to suggest the label is carved
                        into the chassis itself. */}
                    {Array.from({ length: expansionCount }, (_, i) => expansionCount - i).map((exp) => (
                      <div key={`exp-${exp}`} className="relative flex items-center">
                        {renderPanel(exp)}
                        {/* Number floats out to the right of the panel
                            block via absolute positioning so it doesn't
                            take flex space — that keeps the panel
                            centred under the chassis the same way as
                            the main panel below (which has no number),
                            so all rows of keys line up vertically.
                            The chassis card's right padding is 32px
                            (p-8), so we anchor the number's centre at
                            16px past the panel edge to land it exactly
                            in the middle of that gutter strip:
                            left-full + ml-4 (16px) puts the number's
                            LEFT at gutter centre, then -translate-x-1/2
                            shifts it back by half its own width — net
                            result, the number's centre sits at gutter
                            centre regardless of how wide the digit
                            renders. */}
                        <div
                          className="pointer-events-none absolute left-full top-1/2 ml-4 -translate-x-1/2 -translate-y-1/2 text-[18px] font-extrabold tabular-nums leading-none"
                          style={{
                            color: 'rgba(34,167,211,0.55)',
                            textShadow: [
                              '0 -1px 0 rgba(255,255,255,0.06)',
                              '0 -2px 2px rgba(255,255,255,0.03)',
                              '0 1px 0 rgba(0,0,0,0.6)',
                              '0 2px 4px rgba(0,0,0,0.4)',
                            ].join(', '),
                          }}
                        >
                          {exp}
                        </div>
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
              <div className="flex-shrink-0 w-full px-4 pb-3 pt-2 lg:px-5 lg:pb-5 lg:pt-3 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
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
                    {/* Deny All / Approve buttons */}
                    <div className="flex gap-3">
                      <button
                        onClick={handleDenyAll}
                        disabled={reviewProcessing}
                        className="bg-red-500 text-white border-none py-2.5 px-6 rounded-[10px] font-bold text-xs cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-600 transition-colors"
                      >
                        {reviewProcessing ? 'Processing...' : 'Deny'}
                      </button>
                      <button
                        onClick={handleResolve}
                        disabled={reviewProcessing || approvedCount === 0}
                        className="bg-[#10b981] text-white border-none py-2.5 px-6 rounded-[10px] font-bold text-xs cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#0ea472] transition-colors"
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
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setActivePage('main'); deselectAll() }}
                          className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                            activePage === 'main'
                              ? 'bg-[#0178a3] text-white'
                              : 'border border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04]'
                          }`}
                        >
                          Main
                        </button>
                        <button
                          type="button"
                          onClick={() => { setActivePage('shift'); deselectAll() }}
                          className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                            activePage === 'shift'
                              ? 'bg-[#0178a3] text-white'
                              : 'border border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04]'
                          }`}
                        >
                          Shift
                        </button>
                      </div>
                    ) : null}

                    {/* Mobile-portrait Copy / Paste / Save row —
                        sits below Main/Shift in column mode. Also
                        re-shown at lg+ when stackHeader is true
                        (small chassis on desktop, mobile-style
                        layout) so the buttons live below the chassis
                        like mobile rather than crowding the header. */}
                    {canEditKeys && (
                      <div className={`flex items-center gap-2 sm:hidden ${stackHeader ? 'lg:flex' : ''}`}>
                        {(_currentUserRole === 'admin' || _currentUserRole === 'manager' || isAdminGlobal) && (
                          <>
                            <button
                              type="button"
                              onClick={handleCopyPanel}
                              className="shrink-0 rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04]"
                            >
                              Copy
                            </button>
                            {panelClipboard && panelClipboard.entries.length > 0 && (
                              <button
                                type="button"
                                onClick={handlePastePanel}
                                title={`Paste from ${panelClipboard.sourceLabel}`}
                                className="shrink-0 rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04]"
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
                            className="shrink-0 rounded-md bg-[#0178a3] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50"
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
            <div
              className="fixed inset-0 bg-black/50 z-[199] lg:hidden"
              onClick={closeInspector}
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
          <div className={`contents ${pickerMode && canEditKeys ? 'lg:hidden' : ''}`}>
          <aside
            ref={inspectorRef}
            className={`
              w-full lg:w-[360px] bg-[#2a2a2a] border-white/[0.06] flex-col overflow-hidden z-[200]
              /* Mobile: bottom sheet */
              fixed left-0 right-0 bottom-0 lg:top-auto
              max-h-[65vh] landscape:max-h-[92dvh] lg:max-h-[calc(100%-48px)] lg:landscape:max-h-[calc(100%-48px)]
              rounded-t-[20px] lg:rounded-[14px]
              border-t lg:border
              shadow-[0_-10px_40px_rgba(0,0,0,0.6)] lg:shadow-[-15px_10px_40px_rgba(0,0,0,0.6)]
              transition-transform duration-[350ms] ease-[cubic-bezier(0.4,0,0.2,1)]
              lg:transition-none
              /* Desktop: absolute overlay */
              lg:absolute lg:right-6 lg:top-6 lg:bottom-auto lg:left-auto
              ${inspectorOpen ? 'flex translate-y-0 lg:flex' : 'flex translate-y-full lg:hidden'}
            `}
          >
            {/* Sheet handle (mobile) */}
            <div className="flex justify-center py-2.5 cursor-grab lg:hidden">
              <div className="w-10 h-[5px] rounded-[3px] bg-white/25" />
            </div>

            {/* Inspector header */}
            <div className="px-[18px] py-4 border-b border-white/[0.06] flex items-center justify-between gap-2.5 flex-shrink-0">
              <div className="flex-1 min-w-0 flex items-center gap-2.5">
                {pickerMode ? (
                  <>
                    <button
                      onClick={() => setPickerMode(false)}
                      className="bg-transparent border border-white/10 rounded-md text-gray-300 cursor-pointer px-2.5 py-[3px] text-sm flex-shrink-0 hover:bg-white/[0.06]"
                    >
                      &larr;
                    </button>
                    <div>
                      <div className="text-[13px] font-semibold text-white">Pick destination</div>
                      {selectedKey?.pickListItemName && (
                        <div className="text-[10px] text-[#22a7d3] mt-0.5 uppercase tracking-wider font-semibold">
                          Currently: {selectedKey.pickListItemName} &middot; {selectedKey.pickListItemType}
                        </div>
                      )}
                    </div>
                  </>
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
                className="flex size-10 shrink-0 items-center justify-center rounded-md bg-transparent text-2xl text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                &times;
              </button>
            </div>

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
                of truth, so hide this in-inspector picker view there. */}
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
                <div className="px-[18px] py-3.5 border-b border-white/[0.06] flex flex-col gap-2.5 flex-shrink-0">
                  <input
                    type="text"
                    placeholder="Search by name or code..."
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    className="w-full text-gray-200 border border-white/10 px-3.5 py-2 rounded-lg text-sm outline-none transition-colors placeholder:text-gray-200 hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
                    autoFocus
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
                      label: t === 'All' ? 'All function types' : t === 'Audio' ? 'Audio I/O' : t,
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
                </div>

                {/* Picker list */}
                <div className="px-[18px] py-3.5 overflow-y-auto flex-1 flex flex-col gap-[18px]">
                  {/* "Unassigned" — mobile-only one-tap key-clear. On
                      desktop the same action lives on the floating
                      picker card, so this row is hidden there. */}
                  {canEditKeys && (() => {
                    const isUnassignedActive = !selectedKey?.pickListItemId
                    return (
                      <div
                        onClick={() => {
                          if (selectedKeyId) clearKey(selectedKeyId)
                          // Always close the picker so this row behaves like
                          // any other selection — even if the key was already
                          // empty (clearKey is a no-op in that case).
                          setPickerMode(false)
                        }}
                        className={`rounded-[10px] px-3.5 py-2.5 flex items-center gap-2.5 cursor-pointer transition-all border sm:hidden ${
                          isUnassignedActive
                            ? 'bg-[rgba(34,167,211,0.12)] border-[rgba(34,167,211,0.5)]'
                            : 'bg-white/[0.03] border-transparent hover:bg-white/[0.06] hover:border-white/10'
                        }`}
                      >
                        <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
                          <span className={`text-xs font-semibold italic whitespace-nowrap overflow-hidden text-ellipsis ${isUnassignedActive ? 'text-[#22a7d3]' : 'text-gray-400'}`}>
                            Unassigned
                          </span>
                          <span className="text-[11px] text-gray-500 whitespace-nowrap">
                            Clear this key
                          </span>
                        </div>
                      </div>
                    )
                  })()}
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
                            className={`rounded-[10px] px-3.5 py-2.5 flex items-center gap-2.5 cursor-pointer transition-all border ${
                              isActive
                                ? 'bg-[#0178a3] border-[#0178a3] text-white'
                                : 'bg-white/[0.03] border-transparent hover:bg-white/[0.06] hover:border-white/10'
                            }`}
                          >
                            <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
                              <span className={`text-xs font-semibold whitespace-nowrap overflow-hidden text-ellipsis ${isActive ? 'text-white' : 'text-gray-200'}`}>
                                {item.name}
                              </span>
                              {item.position && (
                                <span className={`text-[11px] whitespace-nowrap overflow-hidden text-ellipsis ${
                                  isActive ? 'text-white/80' : item.type === 'PTP' ? 'text-[#22a7d3]' : 'text-gray-400'
                                }`}>
                                  {item.position}
                                </span>
                              )}
                              {item.type !== 'PTP' && item.code && (
                                <span className={`text-[10px] font-mono ${isActive ? 'text-white/80' : 'text-[#22a7d3]'}`}>{item.code}</span>
                              )}
                            </div>
                            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md flex-shrink-0 ${
                              isActive
                                ? 'text-white bg-white/20'
                                : 'text-gray-300 bg-white/10'
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
      {/* Floating drag preview for picker chips. Without this the
          dragged chip is clipped by its scroll-column's overflow:auto;
          DragOverlay renders at the document root so the preview
          follows the cursor freely across the chassis. */}
      <DragOverlay dropAnimation={null}>
        {activeDragChip ? (
          <div className="pointer-events-none inline-flex items-center gap-1.5 rounded-md border border-[#0178a3] bg-[#0178a3] px-2.5 py-1 text-xs font-semibold text-white shadow-2xl">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{activeDragChip.name}</span>
            {activeDragChip.code && (
              <span className="font-mono text-[10px] text-white/70">{activeDragChip.code}</span>
            )}
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>
    </AppShell>
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

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    // focusin: close when focus moves outside (Tab to next field).
    // More reliable than onBlur + relatedTarget.
    function onFocusIn(e: FocusEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
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
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-left text-sm text-gray-200 outline-none transition-colors ${
          open ? 'border-[#22a7d3]/50 bg-white/[0.04]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.04]'
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
      {open && (
        <div ref={listRef} className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[260px] overflow-y-auto rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl">
          {options.map((o, idx) => {
            const isActive = o.value === value
            const isHighlight = idx === highlight
            // Selected option fills with the brand cyan + white text
            // (matches the SearchableSelect dropdown). Keyboard /
            // mouse highlight on non-selected rows is just a soft band.
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
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${stateClass}`}
              >
                <span className="truncate">{o.label}</span>
                {isActive && <span className="text-xs">✓</span>}
              </button>
            )
          })}
        </div>
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
}

/**
 * Browse-mode header bar: project switcher + user switcher + prev/next.
 * Same look as the controls on /my-equipment so the experience flows.
 */
/**
 * Project picker for browse mode. Standalone so the parent layout can place
 * it independently of the user switcher (e.g. far right on desktop).
 */
function BrowseProjectDropdown({
  project,
  browseProjects,
  className = '',
}: {
  project: { id: number; name: string }
  browseProjects: Array<{ id: number; name: string }>
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
    router.push(`/my-equipment?project=${nextId}`)
  }

  return (
    <div ref={ref} className={`relative w-full sm:w-auto ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium text-gray-200 transition-colors sm:w-auto sm:justify-start ${
          open
            ? 'border-[#22a7d3]/50 bg-white/[0.04]'
            : 'border-white/10 hover:border-white/20 hover:bg-white/[0.04]'
        }`}
      >
        <span className="truncate sm:max-w-[160px]">{project.name}</span>
        <svg className="size-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 8 10 13 15 8" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 flex max-h-[320px] flex-col rounded-lg border border-white/10 bg-[#2a2a2a] shadow-2xl sm:left-auto sm:min-w-[240px]">
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
                    isActive ? 'bg-[#22a7d3]/10' : 'hover:bg-white/[0.06]'
                  }`}
                >
                  <span className={`text-[12px] font-medium ${isActive ? 'text-[#22a7d3]' : 'text-gray-200'}`}>{p.name}</span>
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
function BrowseMemberSwitcher({
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
      <button
        type="button"
        onClick={() => jumpByOffset(-1)}
        aria-label="Previous user"
        className="flex h-[38px] w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white"
      >
        <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
      </button>
      <div className="relative flex-1 sm:flex-initial">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium text-gray-200 transition-colors sm:w-auto sm:justify-start ${
            open
              ? 'border-[#22a7d3]/50 bg-white/[0.04]'
              : 'border-white/10 hover:border-white/20 hover:bg-white/[0.04]'
          }`}
        >
          <span className="truncate sm:max-w-[200px]">{memberLabel}</span>
          <svg className="size-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 8 10 13 15 8" /></svg>
        </button>
        {open && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 flex max-h-[360px] flex-col rounded-lg border border-white/10 bg-[#2a2a2a] shadow-2xl sm:left-1/2 sm:right-auto sm:min-w-[280px] sm:-translate-x-1/2">
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
                      isActive ? 'bg-[#22a7d3]/10' : 'hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className={`text-[12px] font-medium ${isActive ? 'text-[#22a7d3]' : 'text-gray-200'}`}>{label}</span>
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
        className="flex h-[38px] w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white"
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
function SiblingGearRow({
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
          const catLabel = CAT_SHORT[g.category] ?? g.category
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => {
                if (!isActive && isPanel) {
                  router.push(`/projects/${projectId}/panel/${g.id}?from=my-equipment`)
                }
              }}
              disabled={!isPanel}
              className={`rounded-lg border px-3 py-1.5 text-left text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isActive
                  ? 'border-[#22a7d3] bg-[#22a7d3]/10 text-white'
                  : 'border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04]'
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
