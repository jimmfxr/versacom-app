'use client'

import { useState, useEffect, useCallback, useRef, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeftIcon } from '@heroicons/react/24/outline'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/button'
import { showToast } from '@/components/toast'
import { saveKeys, saveDraftKeys, submitChanges, addExpansion, removeExpansion, resolveChangeRequests } from './actions'

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
    id: number
    firstName: string
    lastName: string
    position: string | null
    displayName: string
    /** First panel-or-any equipment ID for this member, used to resolve
     *  prev/next navigation. Null when the member has no equipment. */
    equipmentId: number | null
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

  /* ─── State ─── */
  const [activePage, setActivePage] = useState<'main' | 'shift'>('main')
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState(false)
  const [keys, setKeys] = useState<KeyState[]>(() => initializeKeys(initialPanelKeys, keyCount))
  const [clipboard, setClipboard] = useState<{ pickListItemId: number | null; pickListItemName: string | null; pickListItemType: string | null; triggerMode: string } | null>(null)
  const [flashingKey, setFlashingKey] = useState<{ id: string; color: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerFilter, setPickerFilter] = useState<string>('All')
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragType, setDragType] = useState<'key' | 'picklist' | null>(null)
  const [dragPickData, setDragPickData] = useState<PickerItem | null>(null)
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

  /* ─── Initialize keys from server data ─── */
  const expKeyCount = getExpansionKeyCount(equipment.hardwareType)

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
    setSelectedKeyId(id)
    const key = getKey(id)
    if (key) {
      setInspectorOpen(true)
      setPickerMode(false)
    }
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
    })
    updateKey(id, {
      pickListItemId: null,
      pickListItemName: null,
      pickListItemType: null,
      triggerMode: 'latch',
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
      triggerMode: 'latch',
      status: isRequestMode ? 'changed' : 'assigned',
    })
    setPickerMode(false)
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

  /* ─── Keyboard shortcuts ─── */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return

      if (e.key === 'Escape') {
        if (pickerMode) {
          setPickerMode(false)
        } else if (inspectorOpen) {
          closeInspector()
        } else {
          deselectAll()
        }
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

  /* ─── Drag handlers ─── */
  function handleKeyDragStart(id: string) {
    if (!canEditKeys) return
    const key = getKey(id)
    if (!key || key.status === 'empty') return
    setDragSourceId(id)
    setDragType('key')
    selectKey(id)
  }

  function handlePickDragStart(item: PickerItem) {
    if (!canEditKeys) return
    setDragType('picklist')
    setDragPickData(item)
    setDragSourceId(null)
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    if (dragType === 'key' && id === dragSourceId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = dragType === 'key' ? 'move' : 'copy'
    setDragOverId(id)
  }

  function handleDragLeave(id: string) {
    if (dragOverId === id) setDragOverId(null)
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    setDragOverId(null)

    if (dragType === 'key' && dragSourceId && targetId !== dragSourceId) {
      const sourceKey = getKey(dragSourceId)
      if (sourceKey) {
        // Overwrite: source content -> target, source becomes empty
        updateKey(targetId, {
          pickListItemId: sourceKey.pickListItemId,
          pickListItemName: sourceKey.pickListItemName,
          pickListItemType: sourceKey.pickListItemType,
          triggerMode: sourceKey.triggerMode,
          status: isRequestMode ? 'changed' : (sourceKey.pickListItemId ? 'assigned' : 'empty'),
        })
        updateKey(dragSourceId, {
          pickListItemId: null,
          pickListItemName: null,
          pickListItemType: null,
          triggerMode: 'latch',
          status: isRequestMode ? 'changed' : 'empty',
        })
        selectKey(targetId)
        flashKey(targetId, '#10b981')
      }
    } else if (dragType === 'picklist' && dragPickData) {
      updateKey(targetId, {
        pickListItemId: dragPickData.id,
        pickListItemName: dragPickData.name,
        pickListItemType: dragPickData.type,
        triggerMode: 'latch',
        status: isRequestMode ? 'changed' : 'assigned',
      })
      // Don't call selectKey() here — that closes the picker. Keeping the
      // picker open lets the user drag item after item without having to
      // re-open "Pick destination" between drops. Just flash the target
      // so they get visual confirmation the drop landed.
      flashKey(targetId, '#10b981')
    }

    setDragSourceId(null)
    setDragType(null)
    setDragPickData(null)
  }

  function handleDragEnd() {
    setDragSourceId(null)
    setDragOverId(null)
    setDragType(null)
    setDragPickData(null)
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
      const isDragOver = dragOverId === id
      const isFlashing = flashingKey?.id === id
      const isEmpty = keyState.status === 'empty'
      const isAssigned = keyState.status === 'assigned'
      const isChanged = keyState.status === 'changed'
      const isSubmitted = keyState.status === 'submitted'

      // Review mode: check if this key has a pending change
      const reviewChange = reviewChangesMap.get(id)
      const hasReviewChange = !!reviewChange
      const isRejected = hasReviewChange && rejectedKeyIds.has(id)

      let keyClasses = 'group relative flex flex-col cursor-pointer transition-all duration-[180ms]'
      keyClasses += ' w-16 h-16 rounded-md border-2'
      keyClasses += ' bg-[#202020] shadow-[0_4px_6px_rgba(0,0,0,0.3)]'

      // State classes
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
      if (isDragOver) keyClasses += ' !border-[#22a7d3] !shadow-[0_0_20px_rgba(34,167,211,0.6)] -translate-y-[3px] !bg-[rgba(34,167,211,0.08)]'
      if (!isSelected && !isDragging && !isDragOver && !hasReviewChange) keyClasses += ' hover:-translate-y-[2px] hover:border-[#4a4a4a]'
      if (hasReviewChange) keyClasses += ' hover:scale-[0.96] active:scale-[0.92]'

      const flashStyle = isFlashing ? { boxShadow: `0 0 20px ${flashingKey.color}80` } : undefined

      return (
        <div
          key={id}
          className={keyClasses}
          style={flashStyle}
          draggable={!isReviewMode && !isEmpty && canEditKeys}
          onClick={() => {
            if (isReviewMode && hasReviewChange) {
              toggleRejectKey(id)
            } else if (!isReviewMode) {
              selectKey(id)
            }
          }}
          onDragStart={() => handleKeyDragStart(id)}
          onDragOver={(e) => handleDragOver(e, id)}
          onDragLeave={() => handleDragLeave(id)}
          onDrop={(e) => handleDrop(e, id)}
          onDragEnd={handleDragEnd}
        >
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
                {keyState.pickListItemName}
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
        </div>
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedKeyId, dragSourceId, dragOverId, flashingKey, canEditKeys, isRequestMode, isReviewMode, reviewChangesMap, rejectedKeyIds, keys]
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
      <div className="flex flex-col" style={{ height: 'calc(100dvh - 56px)' }}>
        <div className="flex flex-1 overflow-hidden relative min-h-0">

          {/* ─── Editor workspace ─── */}
          <div className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative ${inspectorOpen ? 'lg:pr-0' : ''}`}>
            {/* Back link — pinned to the very top of the workspace.
                User-only accounts can't access the project page (proxy
                blocks it), so route them back to My Equipment instead. */}
            <div className="flex-shrink-0 mx-auto w-full max-w-7xl flex flex-wrap items-center justify-between gap-3 pt-3 px-4 sm:px-6 lg:px-8">
              {/* The back button is only useful when the admin/manager came
                  in from a project tab or an admin review. Browse mode and
                  the user-only role both treat panel studio as the entire
                  My Equipment experience, so the back button would just
                  reload the same page — hide it. */}
              {!isBrowseMode && !isUserOnly && (
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

              {/* Browse-mode title — matches Dashboard / Tasks page heading
                  so admin/manager get a consistent "My Equipment" anchor. */}
              {isBrowseMode && (
                <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  My Equipment
                </h1>
              )}

              {/* Browse-mode controls — project + user dropdowns and prev/next.
                  ml-auto pushes them to the far right even when the back
                  button next to them is hidden. */}
              {isBrowseMode && browseProjects && browseMembers && (
                <div className="w-full sm:ml-auto sm:w-auto">
                  <BrowseHeader
                    project={project}
                    member={member}
                    browseProjects={browseProjects}
                    browseMembers={browseMembers}
                  />
                </div>
              )}
            </div>

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

            <div className="flex flex-col items-center justify-center flex-1 min-h-0">

              {/* ─── Header (pinned) ─── */}
              <div className="flex-shrink-0 w-full px-5 pt-2 pb-2 text-center lg:pt-3 lg:pb-4">
                <div className="flex items-baseline gap-3.5 flex-wrap justify-center mb-1">
                  <div className="text-[22px] font-bold text-white">{memberName}</div>
                  {memberMeta && <div className="text-[13px] text-gray-400">{memberMeta}</div>}
                  {showIpAddress && equipment.ipAddress && (
                    <a
                      href={`http://${equipment.ipAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] text-[#22a7d3] font-mono hover:underline"
                    >
                      {equipment.ipAddress}
                    </a>
                  )}
                </div>
                <div className="text-xs text-gray-500 mb-3.5 text-center">
                  {project.name}
                  <span className="mx-2 text-[#3a3a3a]">&middot;</span>
                  {equipment.hardwareType || 'Unknown'}
                  <span className="text-gray-500"> &middot; {keyCount}-Key</span>
                </div>

                {/* Review mode banner */}
                {isReviewMode && (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/30 mb-2">
                    <svg className="size-4 text-[#f59e0b]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                    <span className="text-xs font-semibold text-[#f59e0b]">Reviewing change request</span>
                  </div>
                )}

                {/* Legend + Expansion controls */}
                <div className="flex gap-4 flex-wrap justify-center">
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <span className="w-[9px] h-[9px] rounded-sm bg-[#10b981] shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
                    Assigned
                  </div>
                  {isRequestMode && (
                    <>
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                        <span className="w-[9px] h-[9px] rounded-sm bg-[#f59e0b] shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
                        Changed (draft)
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                        <span className="w-[9px] h-[9px] rounded-sm bg-[#10b981] shadow-[0_0_6px_rgba(16,185,129,0.4)] border border-[#10b981]" />
                        Submitted
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <span className="w-[9px] h-[9px] rounded-sm border border-dashed border-gray-600 bg-transparent" />
                    Unassigned
                  </div>

                  {canManageExpansions && isExpandable && (
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs text-gray-300">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Expansions</span>
                      <span className="font-semibold text-white">{expansionCount}</span>
                      <div className="inline-flex gap-1.5 ml-1">
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
                  )}
                </div>
              </div>

              {/* ─── Scrollable panel content ─── */}
              <div
                className={`flex-[0_1_auto] min-h-0 w-full overflow-auto p-4 lg:p-5 lg:px-10 flex transition-[padding-right] duration-300 ${inspectorOpen ? 'xl:pr-[420px] 2xl:pr-10' : ''}`}
              >
                <div className="min-w-min mx-auto" ref={chassisRef}>
                  {/* Single chassis card containing expansions + main panel */}
                  <div className="bg-[#2a2a2a] border border-white/[0.06] rounded-[14px] p-8 flex flex-col gap-4 items-center">
                    {/* Expansion rows (rendered on top, reversed so newest is at top) */}
                    {Array.from({ length: expansionCount }, (_, i) => expansionCount - i).map((exp) => (
                      <div key={`exp-${exp}`} className="flex flex-col gap-4 items-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-600">
                          Expansion {exp}
                        </div>
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

              {/* ─── Footer (pinned) ─── */}
              <div className="flex-shrink-0 px-4 pb-3 pt-2 flex flex-col items-center gap-3 w-full lg:px-5 lg:pb-5 lg:pt-3">
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
                    {/* Main/Shift toggle (panels only) */}
                    {hasShiftPage && (
                      <div className="inline-flex bg-[#2a2a2a] p-1 rounded-[10px] border border-white/[0.06]">
                        <button
                          onClick={() => { setActivePage('main'); deselectAll() }}
                          className={`border-none text-[11px] font-bold py-2 px-[22px] rounded-[7px] tracking-wider uppercase cursor-pointer transition-colors ${activePage === 'main' ? 'bg-[#0178a3] text-white' : 'bg-transparent text-gray-400'}`}
                        >
                          Main
                        </button>
                        <button
                          onClick={() => { setActivePage('shift'); deselectAll() }}
                          className={`border-none text-[11px] font-bold py-2 px-[22px] rounded-[7px] tracking-wider uppercase cursor-pointer transition-colors ${activePage === 'shift' ? 'bg-[#0178a3] text-white' : 'bg-transparent text-gray-400'}`}
                        >
                          Shift
                        </button>
                      </div>
                    )}

                    {/* Save/Submit button */}
                    {canEditKeys && (
                      <div className="flex items-center gap-2">
                        {(_currentUserRole === 'admin' || _currentUserRole === 'manager' || isAdminGlobal) && (
                          <>
                            <button
                              type="button"
                              onClick={handleCopyPanel}
                              className="rounded-lg border border-white/10 bg-[#2a2a2a] px-4 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
                            >
                              Copy
                            </button>
                            {panelClipboard && panelClipboard.entries.length > 0 && (
                              <button
                                type="button"
                                onClick={handlePastePanel}
                                title={`Paste from ${panelClipboard.sourceLabel}`}
                                className="rounded-lg border border-white/10 bg-[#2a2a2a] px-4 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
                              >
                                Paste
                              </button>
                            )}
                          </>
                        )}
                        {!isRequestMode && (
                          <Button onClick={handleSave} disabled={saving} size="sm">
                            {saving ? 'Saving...' : 'Save'}
                          </Button>
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

          {/* ─── Inspector ─── */}
          <aside
            ref={inspectorRef}
            className={`
              w-full lg:w-[360px] bg-[#2a2a2a] border-white/[0.06] flex-col overflow-hidden z-[200]
              /* Mobile: bottom sheet */
              fixed left-0 right-0 bottom-0 lg:top-auto
              max-h-[65vh] lg:max-h-[calc(100%-48px)]
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
                className="bg-transparent border-none text-gray-400 text-lg cursor-pointer p-1 px-2 rounded-md flex-shrink-0 hover:text-white hover:bg-white/[0.06]"
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

            {/* Picker view */}
            {pickerMode && (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Picker controls */}
                <div className="px-[18px] py-3.5 border-b border-white/[0.06] flex flex-col gap-2.5 flex-shrink-0">
                  <input
                    type="text"
                    placeholder="Search by name or code..."
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    className="w-full bg-[#2a2a2a] text-white border-2 border-white/10 px-4 py-2.5 rounded-lg text-base outline-none transition-[border-color] placeholder:text-gray-500 focus:border-[#0178a3]"
                    autoFocus
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {/* Filter chips */}
                  <div className="flex w-full bg-[#2a2a2a] p-1 rounded-lg">
                    {filterTypes.map((type) => (
                      <button
                        key={type}
                        onClick={() => setPickerFilter(type)}
                        className={`flex-1 min-w-0 border-none px-1.5 py-[7px] rounded-md text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap overflow-hidden text-ellipsis ${
                          pickerFilter === type
                            ? 'bg-[#0178a3] text-white'
                            : 'bg-transparent text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Picker list */}
                <div className="px-[18px] py-3.5 overflow-y-auto flex-1 flex flex-col gap-[18px]">
                  {/* "Unassigned" — always at the top so mobile users have a
                      one-tap way to clear a key (no backspace on touch).
                      Styled to match the other picker items, including the
                      cyan-active state when the key is currently empty. */}
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
                        className={`rounded-[10px] px-3.5 py-2.5 flex items-center gap-2.5 cursor-pointer transition-all border ${
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
                          <div
                            key={`${item.type}-${item.id}`}
                            draggable={canEditKeys}
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = 'copy'
                              e.dataTransfer.setData('text/plain', '')
                              handlePickDragStart(item)
                            }}
                            onDragEnd={handleDragEnd}
                            onClick={() => selectedKeyId && assignPickerItem(selectedKeyId, item)}
                            className={`rounded-[10px] px-3.5 py-2.5 flex items-center gap-2.5 cursor-pointer transition-all border ${
                              isActive
                                ? 'bg-[rgba(34,167,211,0.12)] border-[rgba(34,167,211,0.5)]'
                                : 'bg-white/[0.03] border-transparent hover:bg-white/[0.06] hover:border-white/10'
                            }`}
                          >
                            <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
                              <span className={`text-xs font-semibold whitespace-nowrap overflow-hidden text-ellipsis ${isActive ? 'text-[#22a7d3]' : 'text-gray-200'}`}>
                                {item.name}
                              </span>
                              {item.position && (
                                <span className="text-[11px] text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis">
                                  {item.position}
                                </span>
                              )}
                              {item.code && (
                                <span className="text-[10px] text-gray-500 font-mono">{item.code}</span>
                              )}
                            </div>
                            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md flex-shrink-0 ${
                              isActive
                                ? 'text-[#22a7d3] bg-[rgba(34,167,211,0.18)]'
                                : 'text-gray-300 bg-white/10'
                            }`}>
                              {item.type === 'Audio_IO' ? 'Audio I/O' : item.type}
                            </span>
                            {isActive && (
                              <span className="text-[#22a7d3] font-bold text-sm ml-1">&check;</span>
                            )}
                          </div>
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
    </AppShell>
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
function BrowseHeader({
  project,
  member,
  browseProjects,
  browseMembers,
}: {
  project: { id: number; name: string }
  member: { id: number } | null
  browseProjects: Array<{ id: number; name: string }>
  browseMembers: Array<{
    id: number
    firstName: string
    lastName: string
    position: string | null
    displayName: string
    equipmentId: number | null
  }>
}) {
  const router = useRouter()
  const [open, setOpen] = useState<'project' | 'member' | null>(null)
  const [projectQuery, setProjectQuery] = useState('')
  const [memberQuery, setMemberQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const memberInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    if (open) document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Reset filter and focus the input every time a dropdown opens so the user
  // can start typing immediately to narrow shows / users.
  useEffect(() => {
    if (open === 'project') {
      setProjectQuery('')
      projectInputRef.current?.focus()
    } else if (open === 'member') {
      setMemberQuery('')
      memberInputRef.current?.focus()
    }
  }, [open])

  const filteredProjects = projectQuery.trim()
    ? browseProjects.filter((p) =>
        p.name.toLowerCase().includes(projectQuery.trim().toLowerCase()),
      )
    : browseProjects
  const filteredMembers = memberQuery.trim()
    ? browseMembers.filter((m) => {
        const q = memberQuery.trim().toLowerCase()
        return (
          m.displayName.toLowerCase().includes(q) ||
          (m.position ?? '').toLowerCase().includes(q)
        )
      })
    : browseMembers

  const currentMember = member ? browseMembers.find((m) => m.id === member.id) : null
  const memberLabel = currentMember
    ? currentMember.position
      ? `${currentMember.displayName} · ${currentMember.position}`
      : currentMember.displayName
    : '—'
  const currentMemberIndex = currentMember
    ? browseMembers.findIndex((m) => m.id === currentMember.id)
    : -1

  function navigateToMember(memberId: number) {
    const target = browseMembers.find((m) => m.id === memberId)
    if (!target || target.equipmentId == null) return
    router.push(`/projects/${project.id}/panel/${target.equipmentId}?from=my-equipment`)
  }

  function jumpToMemberByOffset(offset: number) {
    if (browseMembers.length === 0 || currentMemberIndex < 0) return
    const wrapped = ((currentMemberIndex + offset) % browseMembers.length + browseMembers.length) % browseMembers.length
    navigateToMember(browseMembers[wrapped].id)
  }

  function navigateToProject(nextId: number) {
    if (nextId === project.id) return
    // Land on /my-equipment for the new project — no specific equipment yet.
    router.push(`/my-equipment?project=${nextId}`)
  }

  return (
    <div ref={ref} className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
      {/* Project dropdown */}
      <div className="relative w-full sm:w-auto">
        <button
          type="button"
          onClick={() => setOpen(open === 'project' ? null : 'project')}
          className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium text-gray-200 transition-colors sm:w-auto sm:justify-start ${
            open === 'project'
              ? 'border-[#22a7d3]/50 bg-white/[0.04]'
              : 'border-white/10 hover:border-white/20 hover:bg-white/[0.04]'
          }`}
        >
          <span className="truncate sm:max-w-[160px]">{project.name}</span>
          <svg className="size-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 8 10 13 15 8" /></svg>
        </button>
        {open === 'project' && (
          <div className="absolute right-0 top-full z-30 mt-1 flex max-h-[320px] min-w-[240px] flex-col rounded-lg border border-white/10 bg-[#2a2a2a] shadow-2xl">
            <input
              ref={projectInputRef}
              type="text"
              value={projectQuery}
              onChange={(e) => setProjectQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filteredProjects.length > 0) {
                  e.preventDefault()
                  setOpen(null)
                  navigateToProject(filteredProjects[0].id)
                } else if (e.key === 'Escape') {
                  setOpen(null)
                }
              }}
              placeholder="Search shows…"
              className="m-1 rounded-md border border-white/10 bg-[#202020] px-2.5 py-1.5 text-[12px] text-gray-200 placeholder:text-gray-500 focus:border-[#22a7d3]/50 focus:outline-none"
            />
            <div className="overflow-y-auto p-1 pt-0">
              {filteredProjects.map((p) => {
                const isActive = p.id === project.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setOpen(null); navigateToProject(p.id) }}
                    className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                      isActive ? 'bg-[#22a7d3]/10' : 'hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className={`text-[12px] font-medium ${isActive ? 'text-[#22a7d3]' : 'text-gray-200'}`}>{p.name}</span>
                  </button>
                )
              })}
              {filteredProjects.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-gray-500">No shows match</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* User dropdown + prev/next */}
      <div className="flex w-full items-center gap-1 sm:w-auto">
        <button
          type="button"
          onClick={() => jumpToMemberByOffset(-1)}
          aria-label="Previous user"
          className="flex h-[38px] w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white"
        >
          <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        </button>
        <div className="relative flex-1 sm:flex-initial">
          <button
            type="button"
            onClick={() => setOpen(open === 'member' ? null : 'member')}
            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium text-gray-200 transition-colors sm:w-auto sm:justify-start ${
              open === 'member'
                ? 'border-[#22a7d3]/50 bg-white/[0.04]'
                : 'border-white/10 hover:border-white/20 hover:bg-white/[0.04]'
            }`}
          >
            <span className="truncate sm:max-w-[200px]">{memberLabel}</span>
            <svg className="size-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 8 10 13 15 8" /></svg>
          </button>
          {open === 'member' && (
            <div className="absolute right-0 top-full z-30 mt-1 flex max-h-[360px] min-w-[280px] flex-col rounded-lg border border-white/10 bg-[#2a2a2a] shadow-2xl">
              <input
                ref={memberInputRef}
                type="text"
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const first = filteredMembers.find((m) => m.equipmentId != null)
                    if (first) {
                      e.preventDefault()
                      setOpen(null)
                      navigateToMember(first.id)
                    }
                  } else if (e.key === 'Escape') {
                    setOpen(null)
                  }
                }}
                placeholder="Search users…"
                className="m-1 rounded-md border border-white/10 bg-[#202020] px-2.5 py-1.5 text-[12px] text-gray-200 placeholder:text-gray-500 focus:border-[#22a7d3]/50 focus:outline-none"
              />
              <div className="overflow-y-auto p-1 pt-0">
                {filteredMembers.map((m) => {
                  const isActive = currentMember?.id === m.id
                  const label = m.position ? `${m.displayName} · ${m.position}` : m.displayName
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setOpen(null); navigateToMember(m.id) }}
                      disabled={m.equipmentId == null}
                      className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors disabled:opacity-40 ${
                        isActive ? 'bg-[#22a7d3]/10' : 'hover:bg-white/[0.06]'
                      }`}
                    >
                      <span className={`text-[12px] font-medium ${isActive ? 'text-[#22a7d3]' : 'text-gray-200'}`}>{label}</span>
                    </button>
                  )
                })}
                {filteredMembers.length === 0 && (
                  <div className="px-3 py-2 text-[12px] text-gray-500">No users match</div>
                )}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => jumpToMemberByOffset(1)}
          aria-label="Next user"
          className="flex h-[38px] w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white"
        >
          <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        </button>
      </div>
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
                  : 'border-white/10 bg-[#2a2a2a] text-gray-300 hover:border-white/20 hover:bg-[#313131]'
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
