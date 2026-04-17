'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/button'
import { showToast } from '@/components/toast'
import { saveKeys, saveDraftKeys, submitChanges, addExpansion, removeExpansion } from './actions'

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
  'KP-5032': 32, 'KP32': 32, 'RSP-2318': 18, 'RSP-2312': 12,
  'Helixnet': 2, 'DBP': 4, 'ST-374': 4, 'ST370': 2,
  'C3': 2, 'BP325': 2, 'Bolero': 6, 'Freespeak': 5, 'Pliant': 4,
}

/* Get the block layout for a hardware type.
   `rows` = how many rows the MAIN panel occupies.
   Expansions always use 1 row (same keysPerBlock × blocksPerRow). */
function getBlockLayout(hardwareType: string | null): { keysPerBlock: number; blocksPerRow: number; rows: number } {
  const keyCount = hardwareType ? (HARDWARE_KEY_COUNTS[hardwareType] ?? 16) : 16
  if (keyCount <= 2) return { keysPerBlock: keyCount, blocksPerRow: 1, rows: 1 }
  if (keyCount <= 6) return { keysPerBlock: keyCount, blocksPerRow: 1, rows: 1 }
  if (keyCount === 12) return { keysPerBlock: 6, blocksPerRow: 2, rows: 1 }
  if (keyCount === 18) return { keysPerBlock: 9, blocksPerRow: 2, rows: 1 }
  if (keyCount === 16) return { keysPerBlock: 8, blocksPerRow: 2, rows: 1 }
  if (keyCount === 32) return { keysPerBlock: 8, blocksPerRow: 2, rows: 2 }
  return { keysPerBlock: 8, blocksPerRow: 2, rows: 1 }
}

/* Expansion key count: always 1 row of keys (e.g. RSP-1232 expansion = 16 keys, not 32) */
function getExpansionKeyCount(hardwareType: string | null): number {
  const l = getBlockLayout(hardwareType)
  return l.keysPerBlock * l.blocksPerRow // 1 row worth of keys
}

function getKeyCount(hardwareType: string | null): number {
  return hardwareType ? (HARDWARE_KEY_COUNTS[hardwareType] ?? 16) : 16
}

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
}: PanelStudioProps) {
  void _currentUserRole
  void _currentMemberId
  const router = useRouter()
  const keyCount = getKeyCount(equipment.hardwareType)
  const layout = getBlockLayout(equipment.hardwareType)

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

    for (let exp = 0; exp <= maxExpansion; exp++) {
      // Main panel uses full key count; expansions use 1 row (e.g. 16 for RSP-1232)
      const count = exp === 0 ? mainKeys : expKeyCount
      for (const page of ['main', 'shift'] as const) {
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
        for (const page of ['main', 'shift'] as const) {
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
      selectKey(targetId)
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
  const allPickerItems: PickerItem[] = [
    ...ptpMembers.map((m) => ({
      id: m.id * -1, // negative IDs for PTP to distinguish from PickListItems
      code: null,
      name: m.name,
      type: 'PTP',
      position: m.position,
    })),
    ...pickListItems.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      type: p.type,
      position: null,
    })),
  ]

  const filterTypes = ['All', 'PTP', 'CONF', 'IFB', 'Audio', 'GRP']

  const filteredPickerItems = allPickerItems.filter((item) => {
    const matchesFilter =
      pickerFilter === 'All' ||
      (pickerFilter === 'Audio' ? item.type === 'Audio_IO' : item.type === pickerFilter)
    const searchLower = pickerSearch.toLowerCase()
    const matchesSearch =
      !pickerSearch ||
      item.name.toLowerCase().includes(searchLower) ||
      (item.code && item.code.toLowerCase().includes(searchLower)) ||
      (item.position && item.position.toLowerCase().includes(searchLower))
    return matchesFilter && matchesSearch
  })

  // Group by type
  const groupedItems: Record<string, PickerItem[]> = {}
  for (const item of filteredPickerItems) {
    const group = item.type
    if (!groupedItems[group]) groupedItems[group] = []
    groupedItems[group].push(item)
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

      let keyClasses = 'group relative flex flex-col cursor-pointer transition-all duration-[180ms]'
      keyClasses += ' w-16 h-16 rounded-md border-2'
      keyClasses += ' bg-[#202020] shadow-[0_4px_6px_rgba(0,0,0,0.3)]'

      // State classes
      if (isAssigned) keyClasses += ' border-[#3a3a3a]'
      else if (isChanged) keyClasses += ' border-[#f59e0b] shadow-[0_0_12px_rgba(245,158,11,0.4)]'
      else if (isSubmitted) keyClasses += ' border-[#10b981] shadow-[0_0_12px_rgba(16,185,129,0.4)]'
      else keyClasses += ' border-[#3a3a3a]'

      if (isSelected) keyClasses += ' !border-[#22a7d3] !shadow-[0_0_16px_rgba(34,167,211,0.5)] -translate-y-1'
      if (isDragging) keyClasses += ' opacity-30 scale-[0.92]'
      if (isDragOver) keyClasses += ' !border-[#22a7d3] !shadow-[0_0_20px_rgba(34,167,211,0.6)] -translate-y-[3px] !bg-[rgba(34,167,211,0.08)]'
      if (!isSelected && !isDragging && !isDragOver) keyClasses += ' hover:-translate-y-[2px] hover:border-[#4a4a4a]'

      const flashStyle = isFlashing ? { boxShadow: `0 0 20px ${flashingKey.color}80` } : undefined

      return (
        <div
          key={id}
          className={keyClasses}
          style={flashStyle}
          draggable={!isEmpty && canEditKeys}
          onClick={() => selectKey(id)}
          onDragStart={() => handleKeyDragStart(id)}
          onDragOver={(e) => handleDragOver(e, id)}
          onDragLeave={() => handleDragLeave(id)}
          onDrop={(e) => handleDrop(e, id)}
          onDragEnd={handleDragEnd}
        >
          {/* Tally */}
          <div className="mx-auto mt-1.5 h-1 w-[60%] rounded-sm"
            style={{
              background: isAssigned || isSubmitted
                ? '#10b981'
                : isChanged
                ? '#f59e0b'
                : '#333',
              boxShadow: isAssigned || isSubmitted
                ? '0 0 8px rgba(16,185,129,0.7)'
                : isChanged
                ? '0 0 8px rgba(245,158,11,0.7)'
                : 'none',
            }}
          />
          {/* Display */}
          <div className="flex flex-1 items-center justify-center p-1 relative">
            {isEmpty ? (
              <span className="text-2xl font-light leading-none text-[#3b4352]">+</span>
            ) : (
              <span className="text-[9px] font-bold text-white text-center whitespace-nowrap overflow-hidden max-w-full">
                {keyState.pickListItemName}
              </span>
            )}
          </div>
          {/* Trigger mode indicator */}
          {!isEmpty && keyState.triggerMode !== 'latch' && (
            <div className="absolute bottom-1 right-1.5 text-[9px] font-extrabold text-[#f59e0b] opacity-85 uppercase">
              {triggerLabel(keyState.triggerMode)}
            </div>
          )}
          {!isEmpty && keyState.triggerMode === 'latch' && (
            <div className="absolute bottom-1 right-1.5 text-[9px] font-extrabold text-[#f59e0b] opacity-85 uppercase">
              L
            </div>
          )}
        </div>
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedKeyId, dragSourceId, dragOverId, flashingKey, canEditKeys, isRequestMode, keys]
  )

  /* ─── Render a panel block ─── */
  function renderBlock(visibleKeys: KeyState[], startIdx: number, count: number) {
    const blockKeys = visibleKeys.slice(startIdx, startIdx + count)

    return (
      <div className="p-3.5 rounded-lg">
        <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${Math.min(count, 9)}, 1fr)` }}>
          {blockKeys.map((k) => renderKey(k))}
        </div>
      </div>
    )
  }

  /* ─── Render a full panel (all rows for one expansion) ─── */
  function renderPanel(expansion: number) {
    const visibleKeys = getVisibleKeys(activePage, expansion)
    const { keysPerBlock, blocksPerRow } = layout
    // Main panel uses the full row count; expansions always have 1 row
    const rowCount = expansion === 0 ? layout.rows : 1
    const keysPerRow = keysPerBlock * blocksPerRow

    const panelRows: React.ReactNode[] = []
    for (let row = 0; row < rowCount; row++) {
      const rowStart = row * keysPerRow
      const blocks: React.ReactNode[] = []
      for (let b = 0; b < blocksPerRow; b++) {
        const blockStart = rowStart + b * keysPerBlock
        blocks.push(
          <div key={b}>
            {renderBlock(visibleKeys, blockStart, keysPerBlock)}
          </div>
        )
      }
      panelRows.push(
        <div key={row} className="flex gap-3.5 flex-nowrap">
          {blocks}
        </div>
      )
    }
    return panelRows
  }

  /* ═══════════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════════ */

  const memberName = member ? `${member.firstName} ${member.lastName}` : 'Unassigned'
  const memberMeta = [member?.position, member?.location].filter(Boolean).join(' \u00B7 ')

  return (
    <AppShell userName={userName} isAdmin={isAdminGlobal} isUserOnly={isUserOnly}>
      <div className="flex flex-col" style={{ height: 'calc(100dvh - 56px)' }}>
        <div className="flex flex-1 overflow-hidden relative min-h-0">

          {/* ─── Editor workspace ─── */}
          <div className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative ${inspectorOpen ? 'lg:pr-0' : ''}`}>
            <div className="flex flex-col items-center justify-center flex-1 min-h-0">

              {/* ─── Header (pinned) ─── */}
              <div className="flex-shrink-0 text-center w-full px-5 pt-4 pb-2 lg:pt-5 lg:pb-4">
                {/* Back link */}
                <div className="mb-2">
                  <button
                    onClick={() => router.push(`/projects/${project.id}`)}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    &larr; Back to {project.name}
                  </button>
                </div>

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

                  {canManageExpansions && (
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
                {/* Main/Shift toggle */}
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

                {/* Save/Submit button */}
                {canEditKeys && (
                  <div className="flex gap-2">
                    {!isRequestMode && (
                      <Button onClick={handleSave} disabled={saving} size="sm">
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                    )}
                  </div>
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
