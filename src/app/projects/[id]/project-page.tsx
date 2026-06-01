'use client'

import { useState, useEffect, useRef, useTransition, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { PencilIcon, XMarkIcon, ChevronLeftIcon } from '@heroicons/react/24/outline'
import { QRCodeSVG } from 'qrcode.react'
import { STATUS_BORDER_STYLES, getStatusLabel } from '@/lib/deploy-status'
import {
  MULT_HARDWARE_TYPES,
  FIBER_STRAND_OPTIONS,
  FIBER_DEFAULT_STRANDS,
  MULT_LENGTH_OPTIONS,
  MULT_DEFAULT_LENGTH,
  type MultHardwareType,
} from '@/lib/mults'
import { MultRowHeader, MultStrandList } from '@/components/mult-row'
import { DeployStatusSelect } from '@/components/deploy-status-select'
import { useDeviceReachability } from '@/hooks/use-device-reachability'
import { useBackgroundRefresh } from '@/hooks/use-background-refresh'
import { Button } from '@/components/button'
import { showToast } from '@/components/toast'
import { PageLayout } from '@/components/page-layout'
import { ProjectSwitcher } from '@/app/project-dashboard'
import { Card } from '@/components/card'
import { EmptyState } from '@/components/empty-state'
import { IconButton } from '@/components/icon-button'
import { Modal } from '@/components/modal'
import { FormInput, FormSelect } from '@/components/form-field'
import { SearchableSelect } from '@/components/searchable-select'
import { ComboboxInput } from '@/components/combobox-input'
import { FilterBar, Chip } from '@/components/filter-bar'
import { ChipScroller } from '@/components/chip-scroller'
import { FilterDropdown } from '@/components/filter-dropdown'
import { AutoHideHeader } from '@/components/auto-hide-header'
import { LocationSummary } from '@/components/location-summary'
import { HeadsetInventoryEditor } from '@/components/headset-inventory-editor'
import { usePersistentState } from '@/lib/use-persistent-state'
import { RackStudio } from './racks/[rackId]/rack-studio'
import { updateProject, deleteProject, setReturnPhase, renameLocation } from './actions'
import { bulkCreateEquipment, updateEquipment, deleteEquipment } from './distribution/actions'
import { createPlot, updatePlot, deletePlot } from './plot-actions'
import { createMember, updateMember, deleteMember, bulkCreateMembers } from './team-actions'
import { createPickListItem, updatePickListItem, deletePickListItem } from './picklist-actions'

/* ─── Constants ─── */

const CATEGORIES = [
  { value: 'panels', label: 'Panels', prefix: 'PNL', assignable: true },
  { value: 'wireless_bp', label: 'Wireless BP', prefix: 'WLBP', assignable: true },
  { value: 'hardwire_bp', label: 'Hardwire BP', prefix: 'HWBP', assignable: true },
  { value: 'switches', label: 'Switches', prefix: 'SW', assignable: false },
  { value: 'antennas', label: 'Antennas', prefix: 'ANT', assignable: false },
  { value: 'audio', label: 'Audio', prefix: 'AUD', assignable: false },
  // Mults — cable multipliers. Auto-IDs use a LETTER suffix per
  // hardware-type prefix (FBR A, ETH B, W1 AA, CPC C) instead of the
  // number-based prefix above. See nextMultName() in lib/mults.ts.
  { value: 'mults', label: 'Mults', prefix: 'MULT', assignable: false },
] as const

const HARDWARE_TYPES: Record<string, string[]> = {
  panels: ['RSP-1232', 'RSP-1216', 'DSP-1216', 'KP-5032', 'KP32', 'RSP-2318', 'DSP-2312', 'DKP-3016', 'KP-3016', 'DSPK4'],
  wireless_bp: ['Bolero 1.9', 'Bolero 2.4', 'Freespeak', 'Pliant'],
  hardwire_bp: ['Helixnet', 'DBP4', 'DBP5', 'ST-374', 'ST370', 'C3', 'BP325'],
  switches: ['26P+4F', '40P+4F', '24X8F8V', '16F', '9P+1F', 'Intellanet Old', 'Intellanet New', 'Media', 'Antaira', 'TP Link', 'Pliant Copper Hub', 'Pliant Fiber Hub'],
  antennas: ['Bolero 1.9', 'Bolero 2.4', 'Pliant', 'Freespeak 1.9', 'Freespeak 2.4'],
  audio: ['NA2', 'A16r', 'Dark88'],
  mults: ['Fiber', 'Ethernet', 'W1', 'CPC'],
}

/**
 * Hardware types that should pre-fill the IP field with a known network
 * prefix when no IP is set yet. Lookup is exact (case-sensitive) by the
 * hardwareType string, so it doesn't matter which category the row is in.
 */
const IP_PREFIX_BY_HARDWARE: Record<string, string> = {
  // Riedel panels live on the 10.240.x.x net.
  'RSP-1216': '10.240.',
  'RSP-1232': '10.240.',
  'RSP-2318': '10.240.',
  'DSP-1216': '10.240.',
  'DSP-2312': '10.240.',
  // Bolero antennas share the same Riedel network — same 10.240.x.x prefix.
  // (Wireless beltpacks of the same hardware name don't render an IP field
  // at all, so this only fires when the row is in the antennas category.)
  'Bolero 1.9': '10.240.',
  'Bolero 2.4': '10.240.',
  // Cisco-style network switches we manage live on 10.249.x.x.
  '26P+4F': '10.249.',
  '40P+4F': '10.249.',
  '24X8F8V': '10.249.',
  '16F': '10.249.',
  '9P+1F': '10.249.',
}

/**
 * Switch hardware types that aren't network-managed (no IP needed). Hide
 * the IP field entirely when the row is one of these.
 */
const NO_IP_HARDWARE = new Set([
  'Antaira',
  'TP Link',
  'Intellanet Old',
  'Intellanet New',
  'Media',
  // Pliant hubs are unmanaged passive infrastructure — no IP.
  'Pliant Copper Hub',
  'Pliant Fiber Hub',
  // Pliant antenna doesn't sit on the Riedel network either — no IP.
  'Pliant',
])

const HEADSET_TYPES = [
  'LWHS 4', 'LWHS 5', 'PH 88', 'Shure Single', 'Shure Double',
  'Pliant Single', 'Pliant Double', 'Max D2', 'DT 200', 'DT 280',
  'DT 290', 'Dave Clark', 'Peltor', 'Dalcom',
]

// Deploy-status constants moved to '@/lib/deploy-status' (imported below).


const FUNCTION_TYPES = ['CONF', 'IFB', 'Audio_IO', 'GRP'] as const
const FUNCTION_TYPE_LABELS: Record<string, string> = {
  CONF: 'CONF',
  IFB: 'IFB',
  Audio_IO: 'Audio I/O',
  GRP: 'GRP',
}

const ROLES = ['admin', 'manager', 'crew', 'user'] as const
const ROLE_LABELS: Record<string, string> = { admin: 'Admin', manager: 'Manager', crew: 'Crew', user: 'User' }

/* ─── Types ─── */

type Tab = 'equipment' | 'team' | 'picklist' | 'my-equipment' | 'stage-plots' | 'racks'

type Member = {
  id: number
  role: string
  position: string | null
  department: string | null
  location: string | null
  userId: number
  firstName: string
  lastName: string
  equipmentNames: string[]
  expansionCount: number
  hasPin: boolean
}

type Project = {
  id: number
  name: string
  pin: string
  status: string
  createdAt: string
  createdBy: { id: number; firstName: string; lastName: string }
  members: Member[]
  returnPhaseActive: boolean
}

type MultStrandItem = {
  id: number
  index: number
  channelName: string
  attachedEquipmentId: number | null
}

type AttachedStrandItem = {
  id: number
  index: number
  channelName: string
  multId: number
  multName: string
  multHardwareType: string | null
}

type EquipmentItem = {
  id: number
  name: string
  category: string
  hardwareType: string | null
  position: string | null
  location: string | null
  headsetType: string | null
  ipAddress: string | null
  patch: string | null
  deployStatus: string
  assignedToId: number | null
  assignedToName: string | null
  assignedToPosition: string | null
  assignedToDepartment: string | null
  assignedMemberId: number | null
  gooseneck: boolean
  footswitches: number
  speakers: number
  // Mult-only fields; null/empty on non-mult rows.
  trunkEquipmentId: number | null
  strandCount: number | null
  lengthFeet: number | null
  strands: MultStrandItem[]
  // Reverse — every mult strand that points AT this row. Switches +
  // Pliant antennas show this list inline; everywhere else it's empty.
  attachedStrands: AttachedStrandItem[]
}

type AssignableMember = { id: number; name: string }

type PickListItemType = { id: number; code: string | null; name: string; type: string; users: string[] }

/* ─── Helpers ─── */

function isAssignable(category: string) {
  return ['panels', 'wireless_bp', 'hardwire_bp'].includes(category)
}

/**
 * Whether an equipment row counts as "in use" for the equipment-tab
 * usage counter. The definition depends on category because the
 * different gear types track utilization differently:
 *
 *   - panels / beltpacks → assigned to a member
 *   - switches / mults   → has a location set
 *   - antennas           → has a location OR a "Name" set
 *                          (the antenna's free-form Name field is
 *                          stored in Equipment.position — the auto-
 *                          generated "ANT 1" `name` column doesn't
 *                          count as a real label since every row
 *                          gets one at bulk-create time)
 *
 * Everything else falls back to the assigned-to-a-member rule.
 */
function isEquipmentUsed(e: {
  category: string
  assignedToId: number | null
  location: string | null
  position: string | null
}): boolean {
  const hasLocation = !!e.location && e.location.trim() !== ''
  if (e.category === 'switches' || e.category === 'mults') {
    return hasLocation
  }
  if (e.category === 'antennas') {
    const hasName = !!e.position && e.position.trim() !== ''
    return hasLocation || hasName
  }
  return e.assignedToId != null
}

/**
 * Natural sort comparator — sorts "C1, C10, C2, C20" as "C1, C2, C10, C20"
 * by splitting each string into runs of digits and non-digits and comparing
 * digit runs numerically. Needed now that auto-generated codes (C1, C2, ...)
 * are no longer zero-padded.
 */
function naturalCompare(a: string, b: string): number {
  const aParts = a.match(/(\d+|\D+)/g) ?? []
  const bParts = b.match(/(\d+|\D+)/g) ?? []
  const len = Math.min(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const ap = aParts[i]
    const bp = bParts[i]
    const aIsNum = /^\d+$/.test(ap)
    const bIsNum = /^\d+$/.test(bp)
    if (aIsNum && bIsNum) {
      const diff = parseInt(ap, 10) - parseInt(bp, 10)
      if (diff !== 0) return diff
    } else {
      const diff = ap.localeCompare(bp, undefined, { sensitivity: 'base' })
      if (diff !== 0) return diff
    }
  }
  return aParts.length - bParts.length
}

/**
 * For sorting team members by equipment number when the search matches
 * an equipment name (e.g. searching "WLBP" should produce WLBP 1, 2, 3,
 * ..., 10 in order — not jumbled by member name). Returns the smallest
 * trailing number across the member's matching equipment names, or null
 * if nothing matches the query.
 */
function lowestMatchingEquipmentNum(equipmentNames: string[], query: string): number | null {
  let lowest: number | null = null
  for (const name of equipmentNames) {
    if (!name.toLowerCase().includes(query)) continue
    const m = name.match(/(\d+)\s*$/)
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (lowest == null || n < lowest) lowest = n
  }
  return lowest
}

function getCategoryLabel(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label || value
}

function hasField(category: string, field: string, hardwareType?: string | null) {
  const panelFields = ['location', 'headsetType', 'ipAddress']
  const wirelessFields = ['headsetType']
  const hardwireFields = ['location', 'headsetType', 'ipAddress']
  // Patch isn't editable on switches anymore — mult strand attachments
  // surface as a "Patched:" line on the switch card automatically, so
  // the manual free-text Patch input would be a duplicate source of
  // truth. Pliant antennas still get a manual Patch input via the
  // antennaFields branch below since their patching workflow is
  // different.
  const switchFields = ['location', 'ipAddress']
  // Antennas get a free-form "Name" alongside the ANT 1 / ANT 2 ID
  // so installers can label them by their physical role (e.g. "FOH
  // Bolero", "PLHQ 2.4"). Stored in the Equipment.position column
  // (unused for other categories).
  // Pliant antennas get an extra "Patch" free-text input so admins
  // can label the patch the antenna sits on at the splitter / hub.
  // Other antenna hardware types (Bolero / Freespeak) don't get it.
  const antennaFields = hardwareType === 'Pliant'
    ? ['location', 'ipAddress', 'position', 'patch']
    : ['location', 'ipAddress', 'position']
  const audioFields = ['location']
  // Mults: location + physical length. Wiring is recorded at the
  // strand level (MultStrand rows + attach dropdowns), not at the
  // mult level — there's no "trunk parent" concept. `strandCount` is
  // editable for Fiber only (Ethernet=5, W1=16, CPC=4 are fixed by
  // hardware spec — see FIXED_STRAND_COUNT).
  const multFields = ['location', 'lengthFeet']
  if (field === 'strandCount' && category === 'mults') {
    return hardwareType === 'Fiber'
  }

  // IP field is hidden for non-managed hardware types — Antaira / TP
  // Link / Intellanet / Media / Pliant hubs on the switches side, and
  // the Pliant antenna on the antennas side. NO_IP_HARDWARE applies
  // to BOTH categories: same hardware name, same rule.
  if (
    field === 'ipAddress' &&
    (category === 'switches' || category === 'antennas') &&
    hardwareType &&
    NO_IP_HARDWARE.has(hardwareType)
  ) {
    return false
  }

  if (category === 'panels') return panelFields.includes(field)
  if (category === 'wireless_bp') return wirelessFields.includes(field)
  if (category === 'hardwire_bp') return hardwireFields.includes(field)
  if (category === 'switches') return switchFields.includes(field)
  if (category === 'antennas') return antennaFields.includes(field)
  if (category === 'audio') return audioFields.includes(field)
  if (category === 'mults') return multFields.includes(field)
  return false
}

/* ─── Icons ─── */

function CloseIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

// FilterDropdown moved to src/components/filter-dropdown.tsx so the
// Tasks page can share the same chip-replacement dropdown UI.

/**
 * Mode switcher for the Add Equipment card. Replaces the side-by-side
 * "Equipment" / "Headsets & Misc" tab buttons with a compact dropdown
 * chip that sits to the left of the card's close X. Chip uses the
 * standard chip-inactive chrome; selected option in the panel takes
 * the cyan fill that the rest of the app's dropdowns use.
 */
function AddTabSwitcher({
  value,
  onChange,
}: {
  value: 'equipment' | 'inventory' | 'mults'
  onChange: (v: 'equipment' | 'inventory' | 'mults') => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const options: Array<{ v: 'equipment' | 'inventory' | 'mults'; label: string }> = [
    { v: 'equipment', label: 'Add Equipment' },
    { v: 'inventory', label: 'Add Headsets & Misc' },
    { v: 'mults', label: 'Add Mults' },
  ]
  const label = options.find((o) => o.v === value)?.label ?? 'Add Equipment'

  return (
    // w-full on mobile, fits-content + min-w-[280px] on desktop —
    // mirrors the ProjectSwitcher / MemberSwitcher dropdown sizing so
    // every prominent dropdown across the app reads the same size.
    <div ref={ref} className="relative w-full sm:inline-block sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2.5 rounded-lg border-2 bg-[#202020] px-3.5 py-2 text-sm font-medium text-white transition-colors sm:min-w-[280px] ${
          open ? 'border-[#0178a3]' : 'border-white/10 hover:border-white/20'
        }`}
      >
        <span>{label}</span>
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
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 min-w-[260px] rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl">
          {options.map((o) => {
            const isActive = value === o.v
            return (
              <button
                key={o.v}
                type="button"
                onClick={() => { onChange(o.v); setOpen(false) }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${
                  isActive ? 'bg-[#0178a3] text-white' : 'text-gray-200 hover:bg-white/[0.06]'
                }`}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WrenchIcon() {
  return (
    <svg className="mx-auto size-12 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg className="mx-auto size-12 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  )
}

/**
 * Mobile-only dropdown for the project-detail tab strip. On desktop the
 * tabs render as a chip row (see ChipScroller usage above); on mobile
 * we collapse them into a single dropdown to save horizontal space.
 */
function TabsMobileDropdown({
  tabs,
  activeTab,
  onSelect,
  compact = false,
}: {
  tabs: Array<{ key: Tab; label: string; count: number }>
  activeTab: Tab
  onSelect: (tab: Tab) => void
  /** Desktop-shrunk variant: matches Edit/Back button size
   *  (px-4 py-2 text-sm). Mobile default keeps the larger
   *  (px-3.5 py-2.5 text-base) trigger for thumb reach. */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Popover lives in a portal so it can escape AutoHideHeader's
  // overflow-hidden when the page chrome auto-hides on scroll.
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  useEffect(() => {
    if (!open) {
      setPopoverPos(null)
      return
    }
    function measure() {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPopoverPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    measure()
    window.addEventListener('resize', measure)
    // Follow the trigger as the page scrolls (don't snap-close the
    // popover) — capture: true catches descendant scroll regions.
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  const active = tabs.find((t) => t.key === activeTab) ?? tabs[0]

  return (
    // Wrapper + button sizing tuned to match the shared ProjectSwitcher
    // (px-3.5 py-2 text-sm border-2 sm:min-w-[280px]) so the Project
    // Details tab dropdown lines up at the same width + height as the
    // project dropdowns on Dashboard / Tasks / My Equipment.
    <div ref={ref} className={`relative w-full ${compact ? 'sm:inline-block sm:w-auto' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2.5 rounded-lg border-2 bg-[#202020] px-3.5 py-2 text-sm font-medium text-white transition-colors ${
          compact ? 'sm:min-w-[280px]' : ''
        } ${
          open ? 'border-[#0178a3]' : 'border-white/10 hover:border-white/20'
        }`}
      >
        <span className="flex items-center gap-2">
          <span>{active.label}</span>
          <span className="text-xs text-gray-500">{active.count}</span>
        </span>
        <svg className={`size-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="5 8 10 13 15 8" />
        </svg>
      </button>
      {open && popoverPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-50 rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl"
          style={{ top: popoverPos.top, left: popoverPos.left, width: popoverPos.width }}
        >
          {tabs.map((t) => {
            const isActive = t.key === activeTab
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setOpen(false)
                  onSelect(t.key)
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                  isActive ? 'bg-[#0178a3]' : 'hover:bg-white/[0.06]'
                }`}
              >
                <span className={`text-sm font-medium ${isActive ? 'text-white' : 'text-gray-200'}`}>{t.label}</span>
                <span className="text-xs text-gray-500">{t.count}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}

function ListIcon() {
  return (
    <svg className="mx-auto size-12 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
  )
}

/**
 * Renders the assigned-users line on a pick-list card.
 * - Desktop (sm+): always shows every user, wrapping to as many rows as needed.
 * - Mobile: clamped to 2 rows by default. If the full text overflows, a
 *   "+N more" button appears that expands to show all users; tapping
 *   "Show less" collapses again.
 *
 * The N is computed visually: we render an offscreen full list, measure how
 * many users fit in 2 rows, and the rest become "+N more".
 */
function PickListUsers({ users }: { users: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const measureRef = useRef<HTMLSpanElement | null>(null)
  const [hiddenCount, setHiddenCount] = useState(0)

  // Recompute hidden count whenever the list or viewport changes. We
  // render every user as its own inline-block span, then walk them and
  // count how many fit on the first two lines (offsetTop transitions).
  useEffect(() => {
    function recompute() {
      const root = measureRef.current
      if (!root) return
      // Desktop: show all, no truncation.
      if (window.matchMedia('(min-width: 640px)').matches) {
        setHiddenCount(0)
        return
      }
      const spans = Array.from(root.querySelectorAll<HTMLElement>('[data-user]'))
      if (spans.length === 0) { setHiddenCount(0); return }
      const firstTop = spans[0].offsetTop
      let rowCount = 1
      let lastRowTop = firstTop
      let visible = 0
      for (const s of spans) {
        if (s.offsetTop !== lastRowTop) {
          rowCount += 1
          lastRowTop = s.offsetTop
          if (rowCount > 2) break
        }
        visible += 1
      }
      setHiddenCount(Math.max(0, spans.length - visible))
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [users])

  // Desktop always shows all; mobile shows all when expanded or when
  // nothing's hidden. Otherwise we let the visual clamp do its job.
  const showAll = expanded || hiddenCount === 0

  return (
    <div className="mt-1.5 text-xs">
      <span
        ref={measureRef}
        className={showAll ? 'text-[#22a7d3]' : 'line-clamp-2 text-[#22a7d3] sm:line-clamp-none'}
      >
        {users.map((u, i) => (
          <span key={i} data-user>
            {u}
            {i < users.length - 1 ? ', ' : ''}
          </span>
        ))}
      </span>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
          className="mt-1 text-gray-400 hover:text-white sm:hidden"
        >
          {expanded ? 'Show less' : `+${hiddenCount} more`}
        </button>
      )}
    </div>
  )
}

/* ─── Main Component ─── */

export function ProjectPage({
  project,
  equipment,
  assignableMembers,
  pickListItems,
  userName,
  isAdmin,
  isUserOnly,
  currentUserRole = 'user',
  currentMemberId,
  firstNameSuggestions = [],
  lastNameSuggestions = [],
  positionSuggestions = [],
  departmentSuggestions = [],
  userProjects = [],
  headsetInventory = [],
  miscInventory = {
    goosenecksBrought: 0,
    footswitchesBrought: 0,
    speakersBrought: 0,
    quarterXlrmBrought: 0,
    db9XlrfBrought: 0,
    rj45XlrmfBrought: 0,
  },
  plots = [],
  commsRacks = [],
  commsCustomDevices = [],
}: {
  project: Project
  equipment: EquipmentItem[]
  assignableMembers: AssignableMember[]
  pickListItems: PickListItemType[]
  userName?: string
  isAdmin?: boolean
  isUserOnly?: boolean
  currentUserRole?: string
  currentMemberId?: number | null
  firstNameSuggestions?: string[]
  lastNameSuggestions?: string[]
  positionSuggestions?: string[]
  departmentSuggestions?: string[]
  userProjects?: Array<{ id: number; name: string }>
  headsetInventory?: Array<{ headsetType: string; brought: number }>
  miscInventory?: {
    goosenecksBrought: number
    footswitchesBrought: number
    speakersBrought: number
    quarterXlrmBrought: number
    db9XlrfBrought: number
    rj45XlrmfBrought: number
  }
  /** Persisted stage plots for this project — label + external URL
   *  (Google Drive share link, typically). Empty on a fresh project. */
  plots?: Array<{ id: number; label: string; url: string }>
  /** RackTemplate rows for this project scoped to dept='comms'. Used
   *  to render the Racks tab body and drive the tab count. Empty on a
   *  fresh project. */
  commsRacks?: Array<{
    id: number
    name: string
    description: string | null
    location: string | null
    totalRU: number
    dept: string
    slotCount: number
    /** Slots are fetched up front (not lazily) so the inline rack
     *  studio expansion can render instantly when the user taps
     *  Edit. Same shape as the standalone rack-studio page expects. */
    slots: Array<{
      id: number
      ruPosition: number
      ruSize: number
      side: string
      deviceType: string
      label: string
      color: string | null
      equipmentId: number | null
    }>
    looseItems: Array<{
      id: number
      deviceType: string
      label: string | null
      equipmentId: number | null
    }>
  }>
  /** Project-scoped custom rack devices. Merged with the hard-coded
   *  presets in the rack studio's device library so users can add
   *  their own gear (a non-preset switch, an obscure DSP) and have
   *  it appear right next to the canned options. */
  commsCustomDevices?: Array<{
    id: number
    name: string
    ruSize: number
    category: string
  }>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Remember this project so the "Projects" nav link comes back here.
  // We do NOT write the shared `selectedProject` cookie from here —
  // visiting Project Details should not override the user's pick on
  // Dashboard / Tasks / My Equipment. That cookie is only set by the
  // explicit ProjectSwitcher dropdown picks on those pages.
  useEffect(() => {
    document.cookie = `lastProject=${project.id};path=/;max-age=${60 * 60 * 24 * 365}`
    document.cookie = `lastProjectName=${encodeURIComponent(project.name)};path=/;max-age=${60 * 60 * 24 * 365}`
  }, [project.id, project.name])

  // Role permissions (based on role within this project)
  const isProjectAdmin = currentUserRole === 'admin'
  const isManager = currentUserRole === 'manager'
  const isCrew = currentUserRole === 'crew'
  const isUser = currentUserRole === 'user'
  // Archived projects become read-only for everyone regardless of role.
  // Users can still navigate in and view, but every edit affordance hides.
  // Un-archive (Restore) is the only mutation available and lives on the
  // Projects list card, plus via the status dropdown in settings once the
  // project has been restored.
  const isArchived = project.status === 'archived'
  const canEditEquipment = !isArchived && (isProjectAdmin || isCrew)
  // Add Equipment is a manager/admin power — crew can edit existing rows but
  // shouldn't be adding new gear to the project from the field.
  const canAddEquipment = !isArchived && isProjectAdmin
  const canEditTeam = !isArchived && (isProjectAdmin || isManager)
  const canEditPickList = !isArchived && (isProjectAdmin || isManager)
  const canChangeStatus = !isArchived && (isProjectAdmin || isCrew)
  // Admins still need the settings panel to restore an archived project
  // (status dropdown lives there), so don't gate canSeeSettings on isArchived.
  const canSeeSettings = isProjectAdmin || isManager

  // Tab state — user role only sees "My Equipment".
  // The activeTab is mirrored from the URL's ?tab= param so deep
  // links land on the right tab. Used by the rack-designer "Back"
  // button to return to /projects/[id]?tab=racks. We sync both at
  // useState init AND in a useEffect so an in-page route change
  // (back / forward / a refreshed query) keeps things in sync.
  const searchParams = useSearchParams()
  const validTabs = new Set<Tab>(['equipment', 'team', 'picklist', 'my-equipment', 'stage-plots', 'racks'])
  const tabFromUrl = searchParams?.get('tab') as Tab | null
  const initialTab: Tab = isUser
    ? 'my-equipment'
    : tabFromUrl && validTabs.has(tabFromUrl) ? tabFromUrl : 'equipment'
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  // Keep activeTab in sync if the URL changes after mount — e.g. the
  // rack-designer Back button routes to ?tab=racks while this page
  // is already mounted somewhere in the React tree.
  useEffect(() => {
    if (isUser) return
    const t = searchParams?.get('tab') as Tab | null
    if (t && validTabs.has(t) && t !== activeTab) {
      setActiveTab(t)
    }
  // activeTab in deps would loop — we only react to URL changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, isUser])
  // Single entrypoint for tab changes — mirrors the new tab into the
  // URL via router.replace (no history entry) so the URL stays the
  // source of truth. Without this, the URL→state useEffect above
  // would fight any local tab change on the next re-render
  // (router.refresh, prop update, etc.) and yank the user back to
  // whatever the URL still said.
  const changeTab = useCallback((next: Tab) => {
    setActiveTab(next)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      params.set('tab', next)
      router.replace(`?${params.toString()}`, { scroll: false })
    }
  }, [router])

  // Settings panel
  const [showSettings, setShowSettings] = useState(false)
  const [name, setName] = useState(project.name)
  const [status, setStatus] = useState(project.status)
  // Optimistic state for the Activate Return / Undo Return toggle so the
  // button label flips instantly without waiting for a refresh.
  const [returnPhaseActive, setReturnPhaseActiveLocal] = useState(project.returnPhaseActive)
  const [returnPending, setReturnPending] = useState(false)
  function handleToggleReturnPhase() {
    const next = !returnPhaseActive
    setReturnPhaseActiveLocal(next)
    setReturnPending(true)
    startTransition(async () => {
      const res = await setReturnPhase(project.id, next)
      setReturnPending(false)
      if (res.error) {
        // Revert optimistic state on failure.
        setReturnPhaseActiveLocal(!next)
        showToast('error', res.error)
        return
      }
      showToast('success', next ? 'Return phase activated' : 'Return phase ended')
      router.refresh()
    })
  }
  const [managerId, setManagerId] = useState(
    () => project.members.find((m) => m.role === 'manager')?.userId.toString() || ''
  )
  const [editError, setEditError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Equipment state — filters persist across navigation (per-project).
  const [eqSearch, setEqSearch] = useState('')
  const [eqCategoryFilter, setEqCategoryFilter] = usePersistentState<string | null>(
    `proj-${project.id}-eqCategory`,
    null,
  )
  const [eqLocationFilter, setEqLocationFilter] = usePersistentState<string | null>(
    `proj-${project.id}-eqLocation`,
    null,
  )
  const [eqChipsExpanded, setEqChipsExpanded] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  // Mobile-only: when true the per-tab search input slides in below
  // the tab dropdown row. Toggled by the search-icon button next to
  // the tab dropdown on mobile.
  const [searchOpen, setSearchOpen] = useState(false)
  // Which tab inside the open Add Equipment card is active. Default = the
  // gear-add form; flip to 'inventory' to manage headset / misc counts that
  // used to live under the Edit button on the Dashboard headsets card.
  const [addTab, setAddTab] = useState<'equipment' | 'inventory' | 'mults'>('equipment')
  const [addEquipmentId, setAddEquipmentId] = useState('')
  const [addCategory, setAddCategory] = useState('panels')
  const [addHardwareType, setAddHardwareType] = useState('')
  const [addQuantity, setAddQuantity] = useState('1')
  // Default Yes — bulk-add gear and immediately stage placeholder team
  // members for each piece, ready for the real person to take over via
  // the kiosk. Flip to No when the equipment is for storage / spares.
  const [addAutoAssign, setAddAutoAssign] = useState(true)
  // Mults-specific add state — separate from the regular gear-add
  // state so switching the dropdown to Mults doesn't clobber whatever
  // category/hardware the user had in the equipment form.
  const [addMultHardwareType, setAddMultHardwareType] = useState<MultHardwareType>('Fiber')
  const [addMultStrandCount, setAddMultStrandCount] = useState<number>(FIBER_DEFAULT_STRANDS)
  const [addMultLength, setAddMultLength] = useState<number>(MULT_DEFAULT_LENGTH)
  const [addMultQuantity, setAddMultQuantity] = useState('1')
  const [addError, setAddError] = useState('')
  const [editingEqId, setEditingEqId] = useState<number | null>(null)
  const [editEqData, setEditEqData] = useState<Partial<EquipmentItem>>({})

  // Team state
  const [teamSearch, setTeamSearch] = useState('')
  const [teamCategoryFilter, setTeamCategoryFilter] = usePersistentState<string | null>(
    `proj-${project.id}-teamCategory`,
    null,
  )
  const [teamSortAbc, setTeamSortAbc] = usePersistentState<boolean>(
    `proj-${project.id}-teamSortAbc`,
    false,
  )
  const [showAddMember, setShowAddMember] = useState(false)
  // Crew users don't get the Add Member form but DO get a standalone QR
  // card they can pull up to show to end users during gear deployment.
  const [showTeamQr, setShowTeamQr] = useState(false)
  const [addMemberData, setAddMemberData] = useState<{ firstName: string; lastName: string; position: string; department: string; quantity: string; role: string; equipmentId: string }>({ firstName: '', lastName: '', position: '', department: '', quantity: '1', role: 'user', equipmentId: '' })
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null)
  const [editMemberData, setEditMemberData] = useState<{ firstName: string; lastName: string; position: string; department: string; role: string }>({ firstName: '', lastName: '', position: '', department: '', role: 'crew' })

  // Keyboard-chain state. The actual hooks that read editingPlId etc.
  // live further down (after those state vars are declared) so we don't
  // hit a use-before-decl error.
  type ChainType = 'equipment' | 'team' | 'picklist'
  const [chainTarget, setChainTarget] = useState<{ type: ChainType; id: number } | null>(null)

  /** Whether the Add Member form is in a blocking state because of the
   *  Equipment ID preview — `true` when the user typed an unparseable ID
   *  or when any of the resolved slots don't exist / are non-assignable.
   *  Used by both the preview block (which colours the chips) and the
   *  Add button (disabled while blocking). Recomputed inline because it
   *  depends on the rendered preview's slot list. */
  const addEquipmentBlocked = (() => {
    const idRaw = addMemberData.equipmentId.trim()
    if (!idRaw) return false
    const m = idRaw.match(/^(.*?)(\d+)$/)
    if (!m) return true
    const prefix = m[1]
    const startN = parseInt(m[2], 10)
    const digitWidth = m[2].length
    const qty = Math.max(1, Math.min(200, parseInt(addMemberData.quantity, 10) || 1))
    for (let i = 0; i < qty; i++) {
      const name = `${prefix}${String(startN + i).padStart(digitWidth, '0')}`
      const eq = equipment.find((e) => e.name === name)
      if (!eq || !isAssignable(eq.category)) return true
    }
    return false
  })()

  // Pick list state
  const [plSearch, setPlSearch] = useState('')
  const [plTypeFilter, setPlTypeFilter] = usePersistentState<string | null>(
    `proj-${project.id}-plType`,
    null,
  )
  const [plSortAbc, setPlSortAbc] = useState(false)
  const [editingPlId, setEditingPlId] = useState<number | null>(null)
  const [editPlData, setEditPlData] = useState<{ code: string; name: string; type: string }>({ code: '', name: '', type: 'CONF' })
  const [showAddPl, setShowAddPl] = useState(false)
  const [addPlData, setAddPlData] = useState<{ code: string; name: string; type: string; quantity: string }>({ code: '', name: '', type: 'CONF', quantity: '1' })

  // Stage plots state (mockup — no API yet)
  const [plotSearch, setPlotSearch] = useState('')
  // Racks tab — filters the rack list by name or location.
  const [rackSearch, setRackSearch] = useState('')
  const [showAddPlot, setShowAddPlot] = useState(false)
  // Inline "Create rack" form on the Racks tab. When true the tab
  // body renders the form above the rack list.
  const [showAddRack, setShowAddRack] = useState(false)
  // Inline rack-studio expansion. When non-null the matching rack's
  // row uncollapses to render the full rack studio (chassis + library
  // + slot edit) right inside the Racks tab — no navigation away.
  // Toggling Edit on the same rack collapses it; clicking Edit on a
  // different rack switches expansion to that one. The standalone
  // /projects/[id]/racks/[rackId] page still works as a deep-link.
  const [expandedRackId, setExpandedRackId] = useState<number | null>(null)
  // Front/Rear toggle for the embedded rack studio. Lifted up to this
  // level so the desktop toolbar row can host the Front/Rear control
  // on the far left of the tab+search row while the rack-studio body
  // keeps its mobile-only side picker. Reset to 'front' every time a
  // different rack is expanded so the operator always starts on the
  // canonical side.
  const [expandedRackSide, setExpandedRackSide] = useState<'front' | 'rear'>('front')
  useEffect(() => { setExpandedRackSide('front') }, [expandedRackId])
  // Inline rack-metadata form. When a rack is expanded the row header
  // replaces the static "name · location · 17RU · 5 slots" strip with
  // editable inputs (name / location / totalRU) plus Save / Delete /
  // Close buttons. Initial values are seeded from the expanded rack
  // each time expandedRackId changes — keeps the form fresh per open.
  const [rackEditForm, setRackEditForm] = useState<{ name: string; location: string; totalRU: string }>({
    name: '', location: '', totalRU: '',
  })
  const [rackEditSaving, setRackEditSaving] = useState(false)
  // setRackEditError used to drive an inline red banner under the
  // row header; now it pipes errors to the shared bottom-right
  // toast queue. Same (msg | null) shape so every caller works
  // unchanged — null is a no-op (toasts auto-dismiss).
  const setRackEditError = (msg: string | null) => {
    if (msg) showToast('error', msg)
  }
  /** In-app confirm prompt for "Delete rack" — replaces window.confirm.
   *  When non-null, the styled Modal at the bottom of this component
   *  is shown asking the operator to confirm. */
  const [rackDeleteConfirm, setRackDeleteConfirm] = useState<{ id: number; name: string } | null>(null)
  useEffect(() => {
    if (expandedRackId == null) return
    const r = commsRacks.find((x) => x.id === expandedRackId)
    if (!r) return
    setRackEditForm({
      name: r.name,
      location: r.location ?? '',
      totalRU: String(r.totalRU),
    })
    setRackEditError(null)
  }, [expandedRackId, commsRacks])
  const [addPlotLabel, setAddPlotLabel] = useState('')
  const [addPlotUrl, setAddPlotUrl] = useState('')
  const [editingPlotId, setEditingPlotId] = useState<number | null>(null)
  const [editPlotData, setEditPlotData] = useState<{ label: string; url: string }>({ label: '', url: '' })
  // Upload-related plot state removed — plots are paste-a-link now,
  // see Add / Edit Plot forms below.

  /* ─── Keyboard chain hooks ───
   *  Three useEffects auto-focus the first input when an edit form
   *  opens (one per editing-id state). A fourth picks up `chainTarget`
   *  after a successful save and focuses the next visible card's Edit
   *  button so the user can press Enter to walk down the list. The
   *  data-edit-form / data-edit-button selectors are how we find the
   *  right DOM nodes without threading refs through every component. */
  // Scroll the just-opened edit form into the middle of its scroll
  // container — without this the Save / Cancel buttons can land off
  // the bottom of the viewport when the user taps Edit on a card near
  // the bottom. block: 'center' keeps the card framed; the browser
  // handles the smooth animation.
  //
  // CRITICAL: focus() must use { preventScroll: true } so the browser
  // doesn't auto-snap to the input and clobber our smooth scroll.
  useEffect(() => {
    if (editingEqId == null) return
    const form = document.querySelector<HTMLFormElement>(`[data-edit-form="equipment"][data-card-id="${editingEqId}"]`)
    form?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    form?.querySelector<HTMLElement>('input:not([type="hidden"])')?.focus({ preventScroll: true })
  }, [editingEqId])
  useEffect(() => {
    if (editingMemberId == null) return
    const form = document.querySelector<HTMLFormElement>(`[data-edit-form="team"][data-card-id="${editingMemberId}"]`)
    form?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Focus + select-all on First Name so the user can start typing
    // to replace the value immediately — same idiom as macOS rename.
    const input = form?.querySelector<HTMLInputElement>('input:not([type="hidden"])')
    input?.focus({ preventScroll: true })
    input?.select()
  }, [editingMemberId])
  useEffect(() => {
    if (editingPlId == null) return
    const form = document.querySelector<HTMLFormElement>(`[data-edit-form="picklist"][data-card-id="${editingPlId}"]`)
    form?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    form?.querySelector<HTMLElement>('input:not([type="hidden"])')?.focus({ preventScroll: true })
  }, [editingPlId])
  useEffect(() => {
    if (!chainTarget) return
    // Short timeout so the post-save router.refresh() commits before we
    // try to hit the next Edit button.
    const id = window.setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>(`[data-edit-button="${chainTarget.type}-${chainTarget.id}"]`)
      if (btn) {
        btn.focus()
        btn.scrollIntoView({ block: 'nearest' })
      }
      setChainTarget(null)
    }, 80)
    return () => window.clearTimeout(id)
  }, [chainTarget])

  /* ─── Arrow-key navigation between Edit buttons ───
   *
   * After a save, focus auto-jumps to the next card's Edit button (the
   * chainTarget useEffect above). From there the user wants to arrow
   * up/down to skip cards before committing — e.g. save card #3,
   * land on #4, but really want to edit #7, so press ↓ ↓ ↓ Enter.
   *
   * We listen at document level for ArrowUp / ArrowDown when the
   * focused element is an Edit button. The list of buttons is
   * collected in DOM order and limited to the same tab prefix
   * (equipment / team / picklist) so arrows never bleed across tabs
   * — they're never visible at the same time anyway, but defensive.
   */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const active = document.activeElement as HTMLElement | null
      if (!active) return
      const tag = active.getAttribute('data-edit-button')
      if (!tag) return
      // Only consider Edit buttons sharing the same prefix (eg. "equipment-")
      // so arrows walk inside the current tab's list, not across tabs.
      const prefix = tag.split('-')[0]
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(`[data-edit-button^="${prefix}-"]`),
      ).filter((btn) => !btn.hasAttribute('disabled') && btn.offsetParent !== null)
      const idx = buttons.indexOf(active as HTMLButtonElement)
      if (idx === -1) return
      e.preventDefault()
      const nextIdx = e.key === 'ArrowDown'
        ? Math.min(idx + 1, buttons.length - 1)
        : Math.max(idx - 1, 0)
      if (nextIdx === idx) return
      const next = buttons[nextIdx]
      next.focus()
      next.scrollIntoView({ block: 'nearest' })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Visibility-aware background refresh — keeps the page in sync with
  // edits coming from other browsers / the kiosk / panel studio etc.
  // Pause whenever the user is mid-edit so we don't redraw under their
  // keystrokes, and during in-flight server actions.
  useBackgroundRefresh(6000, useCallback(() => {
    if (editingEqId !== null || editingMemberId !== null || editingPlId !== null || editingPlotId !== null) return true
    if (isPending) return true
    return false
  }, [editingEqId, editingMemberId, editingPlId, editingPlotId, isPending]))

  // Plots come from the server now (see page.tsx loader). Mutations
  // call createPlot / updatePlot / deletePlot then router.refresh()
  // to re-fetch — no client-side state mirror needed.

  // Device reachability — pings IPs from the browser every 30s (only works on same LAN)
  // Skip hardwire_bp (often DHCP — IPs change too frequently to be reliable)
  const reachableItems = equipment.filter((e) =>
    ['panels', 'switches', 'antennas'].includes(e.category) && e.ipAddress,
  )
  const reachable = useDeviceReachability(reachableItems)

  /* ─── Project actions ─── */

  function handleSaveProject() {
    if (!name.trim()) { setEditError('Project name is required'); return }
    setEditError('')
    startTransition(async () => {
      const formData = new FormData()
      formData.set('name', name.trim())
      formData.set('status', status)
      formData.set('managerId', managerId)
      const result = await updateProject(project.id, formData)
      if (result.error) { setEditError(result.error); return }
      showToast('success', 'Project updated')
      router.refresh()
    })
  }

  function handleDeleteProject() {
    startTransition(async () => {
      const result = await deleteProject(project.id)
      if (result.error) { showToast('error', result.error); return }
      router.push('/projects')
    })
  }

  /* ─── Equipment actions ─── */

  function handleMultBulkAdd() {
    const qty = parseInt(addMultQuantity, 10)
    if (!qty || qty < 1) { setAddError('Quantity must be at least 1'); return }
    if (qty > 200) { setAddError('Quantity must be at most 200'); return }
    setAddError('')
    startTransition(async () => {
      const result = await bulkCreateEquipment(
        project.id,
        'mults',
        addMultHardwareType,
        qty,
        '',
        false,
        // Strand count only matters for Fiber; the server ignores it for
        // the fixed-count types (Ethernet/W1/CPC).
        addMultHardwareType === 'Fiber' ? addMultStrandCount : undefined,
        addMultLength,
      )
      if (result.error) { setAddError(result.error); return }
      showToast('success', `Added ${result.count} ${addMultHardwareType} mult${result.count === 1 ? '' : 's'}`)
      setShowAdd(false)
      setAddMultQuantity('1')
      router.refresh()
    })
  }

  function handleBulkAdd() {
    const qty = parseInt(addQuantity, 10)
    if (!qty || qty < 1) { setAddError('Quantity must be at least 1'); return }
    if (qty > 200) { setAddError('Quantity must be at most 200'); return }
    setAddError('')
    startTransition(async () => {
      const result = await bulkCreateEquipment(project.id, addCategory, addHardwareType, qty, addEquipmentId, addAutoAssign)
      if (result.error) { setAddError(result.error); return }
      const placeholders = (result as { placeholdersCreated?: number }).placeholdersCreated ?? 0
      const label = getCategoryLabel(addCategory)
      showToast(
        'success',
        placeholders > 0
          ? `Added ${result.count} ${label} · auto-assigned ${placeholders} placeholder member${placeholders === 1 ? '' : 's'}`
          : `Added ${result.count} ${label}`,
      )
      setShowAdd(false)
      setAddEquipmentId('')
      setAddHardwareType('')
      setAddQuantity('1')
      // Keep auto-assign default-Yes across uses; don't reset.
      router.refresh()
    })
  }

  function startEqEdit(item: EquipmentItem) {
    setEditingEqId(item.id)
    // Pre-fill the IP field with the network prefix when this row has a
    // recognized hardware type but no IP yet — so admins editing fresh
    // bulk-added rows see "10.240." or "10.249." already there and only
    // type the last octet. Existing IPs are never touched.
    const existingIp = item.ipAddress || ''
    const prefix = item.hardwareType ? IP_PREFIX_BY_HARDWARE[item.hardwareType] : undefined
    const seedIp = !existingIp.trim() && prefix ? prefix : existingIp
    setEditEqData({
      name: item.name,
      hardwareType: item.hardwareType || '',
      position: item.position || '',
      location: item.location || '',
      headsetType: item.headsetType || '',
      ipAddress: seedIp,
      patch: item.patch || '',
      deployStatus: item.deployStatus,
      assignedToId: item.assignedMemberId,
      gooseneck: item.gooseneck ?? false,
      footswitches: item.footswitches ?? 0,
      speakers: item.speakers ?? 0,
      lengthFeet: item.lengthFeet,
      strandCount: item.strandCount,
    })
  }

  function handleSaveEquipment(item: EquipmentItem) {
    // Normalize location to canonical casing if it matches an existing entry case-insensitively
    let normalizedLocation: string | null = null
    if (hasField(item.category, 'location')) {
      const raw = ((editEqData.location as string) || '').trim()
      if (raw) {
        const canonical = allLocations.find((l) => l.toLowerCase() === raw.toLowerCase())
        normalizedLocation = canonical || raw
      }
    }
    startTransition(async () => {
      const result = await updateEquipment(project.id, item.id, {
        name: editEqData.name || item.name,
        hardwareType: (editEqData.hardwareType as string) || null,
        position: hasField(item.category, 'position') ? (editEqData.position as string) || null : null,
        location: normalizedLocation,
        headsetType: hasField(item.category, 'headsetType') ? (editEqData.headsetType as string) || null : null,
        ipAddress: hasField(item.category, 'ipAddress', editEqData.hardwareType as string | null) ? (editEqData.ipAddress as string) || null : null,
        // Patch — when the row's category doesn't expose a Patch input
        // (now true for switches), don't touch the column. `undefined`
        // tells Prisma to skip the field instead of clobbering any
        // pre-existing value to null on save.
        patch: hasField(item.category, 'patch') ? (editEqData.patch as string) || null : undefined,
        deployStatus: (editEqData.deployStatus as string) || 'na',
        assignedToId: isAssignable(item.category) ? (editEqData.assignedToId as number | null) : null,
        // Panel-only misc accessories
        gooseneck: item.category === 'panels' ? Boolean(editEqData.gooseneck) : false,
        footswitches: item.category === 'panels' ? Number(editEqData.footswitches ?? 0) : 0,
        speakers: item.category === 'panels' ? Number(editEqData.speakers ?? 0) : 0,
        // Mult-only: physical length in feet. Null on non-mult rows.
        lengthFeet: hasField(item.category, 'lengthFeet')
          ? ((editEqData.lengthFeet as number | null | undefined) ?? null)
          : null,
        // Fiber-mult-only: strand count. Skipped (undefined) on other
        // categories / hardware types so the column isn't touched.
        strandCount: hasField(item.category, 'strandCount', editEqData.hardwareType as string | null)
          ? ((editEqData.strandCount as number | null | undefined) ?? null)
          : undefined,
      })
      if (result.error) { showToast('error', result.error); return }
      // Auto-cleanup toast — server side detected the previous
      // assignee was a bulk-add placeholder with no other equipment
      // left after this reassign, and removed them. Surface the
      // change so the admin knows the Team tab will be one row
      // lighter on refresh.
      if ('removedPlaceholderName' in result && result.removedPlaceholderName) {
        showToast('success', `Removed placeholder ${result.removedPlaceholderName}`)
      }
      // Chain to the next visible equipment card before clearing the
      // edit state so focus has somewhere to go.
      const idx = filteredEquipment.findIndex((e) => e.id === item.id)
      const next = idx >= 0 ? filteredEquipment[idx + 1] : undefined
      setEditingEqId(null)
      if (next) setChainTarget({ type: 'equipment', id: next.id })
      router.refresh()
    })
  }

  function handleDeleteEquipment(item: EquipmentItem) {
    startTransition(async () => {
      const result = await deleteEquipment(project.id, item.id)
      if (result.error) { showToast('error', result.error); return }
      showToast('success', `${item.name} removed`)
      router.refresh()
    })
  }

  /* ─── Team actions ─── */

  function startMemberEdit(m: Member) {
    setEditingMemberId(m.id)
    setEditMemberData({ firstName: m.firstName, lastName: m.lastName, position: m.position || '', department: m.department || '', role: m.role })
  }

  function handleSaveMember(m: Member) {
    startTransition(async () => {
      const result = await updateMember(project.id, m.id, editMemberData)
      if (result.error) { showToast('error', result.error); return }
      // Chain to next visible team member.
      const idx = filteredMembers.findIndex((mm) => mm.id === m.id)
      const next = idx >= 0 ? filteredMembers[idx + 1] : undefined
      setEditingMemberId(null)
      if (next) setChainTarget({ type: 'team', id: next.id })
      router.refresh()
    })
  }

  function handleDeleteMember(m: Member) {
    startTransition(async () => {
      const result = await deleteMember(project.id, m.id)
      if (result.error) { showToast('error', result.error); return }
      showToast('success', `${m.firstName} ${m.lastName} removed`)
      router.refresh()
    })
  }

  function handleAddMember() {
    if (!addMemberData.firstName.trim() || !addMemberData.lastName.trim()) return
    const qty = Math.max(1, Math.min(200, parseInt(addMemberData.quantity, 10) || 1))
    const startEquipmentId = addMemberData.equipmentId.trim() || undefined
    startTransition(async () => {
      // Single add (no equipment ID) uses createMember; everything else
      // — quantity > 1 OR an equipment ID is set — routes to
      // bulkCreateMembers which handles auto-assignment with replace
      // semantics.
      const result =
        qty === 1 && !startEquipmentId
          ? await createMember(project.id, addMemberData)
          : await bulkCreateMembers(project.id, { ...addMemberData, quantity: qty, startEquipmentId })
      if (result.error) { showToast('error', result.error); return }
      const fn = addMemberData.firstName.trim()
      const ln = addMemberData.lastName.trim()
      if (qty === 1 && !startEquipmentId) {
        showToast('success', `${fn} ${ln} added`)
      } else {
        const r = result as {
          created?: number
          skipped?: number
          replacedAssignments?: Array<{ equipmentName: string; memberName: string }>
          slotsSkipped?: string[]
        }
        const created = r.created ?? 0
        const skipped = r.skipped ?? 0
        const replaced = r.replacedAssignments ?? []
        const slotsSkipped = r.slotsSkipped ?? []
        const parts: string[] = [`Added ${created}`]
        if (skipped > 0) parts.push(`skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}`)
        if (replaced.length > 0) {
          const list = replaced.map((r) => `${r.memberName} from ${r.equipmentName}`).join(', ')
          parts.push(`unassigned ${list}`)
        }
        if (slotsSkipped.length > 0) {
          parts.push(`slots untouched: ${slotsSkipped.join(', ')}`)
        }
        showToast('success', parts.join(' · '))
      }
      // Reset name + position + equipment id fields, keep quantity + role
      // for rapid entry. Card stays open and focus snaps back to First Name.
      setAddMemberData((d) => ({ ...d, firstName: '', lastName: '', position: '', department: '', equipmentId: '' }))
      router.refresh()
      // Refocus First Name. requestAnimationFrame so React has flushed.
      requestAnimationFrame(() => {
        document.getElementById('add-member-first-name')?.focus()
      })
    })
  }

  /* ─── Pick list actions ─── */

  function startPlEdit(item: PickListItemType) {
    setEditingPlId(item.id)
    setEditPlData({ code: item.code || '', name: item.name, type: item.type })
  }

  function handleSavePl(item: PickListItemType) {
    startTransition(async () => {
      const result = await updatePickListItem(project.id, item.id, editPlData)
      if (result.error) { showToast('error', result.error); return }
      // Chain to next visible pick-list item.
      const idx = filteredPickList.findIndex((p) => p.id === item.id)
      const next = idx >= 0 ? filteredPickList[idx + 1] : undefined
      setEditingPlId(null)
      if (next) setChainTarget({ type: 'picklist', id: next.id })
      router.refresh()
    })
  }

  function handleDeletePl(item: PickListItemType) {
    startTransition(async () => {
      const result = await deletePickListItem(project.id, item.id)
      if (result.error) { showToast('error', result.error); return }
      showToast('success', `${item.name} removed`)
      router.refresh()
    })
  }

  function handleAddPl() {
    const hasName = !!addPlData.name.trim()
    const rawQty = parseInt(addPlData.quantity, 10)
    const qty = hasName ? 1 : (Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 0)
    // Must have either a Name (named item) OR a positive Quantity (placeholder batch)
    if (!hasName && qty < 1) return
    startTransition(async () => {
      const result = await createPickListItem(project.id, {
        code: addPlData.code,
        name: addPlData.name,
        type: addPlData.type,
        quantity: qty,
      })
      if (result.error) { showToast('error', result.error); return }
      const count = result.count ?? 1
      const msg = hasName
        ? `${addPlData.name} added`
        : `Added ${count} function${count === 1 ? '' : 's'}`
      showToast('success', msg)
      setShowAddPl(false)
      setAddPlData({ code: '', name: '', type: 'CONF', quantity: '1' })
      router.refresh()
    })
  }

  /* ─── Derived data ─── */

  // Unique locations seen across ALL equipment in this project.
  // Case-insensitive dedupe — first-seen casing wins. Used as combobox suggestions.
  const allLocations = (() => {
    const seen = new Map<string, string>() // lowercase key → original casing
    for (const e of equipment) {
      if (!e.location) continue
      const trimmed = e.location.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (!seen.has(key)) seen.set(key, trimmed)
    }
    return Array.from(seen.values())
  })()

  /* ─── Filtered lists ─── */

  // Distinct equipment locations for the location filter chip row. We include
  // both the equipment's own location AND the assigned member's location, so
  // panels/beltpacks (which usually have no location of their own) show up
  // under the location of whoever they're assigned to.
  // Defined BEFORE filteredEquipment because the filter callback uses it.
  const memberLocationById = new Map<number, string>()
  for (const m of project.members) {
    if (m.location && m.location.trim()) memberLocationById.set(m.id, m.location.trim())
  }
  function effectiveLocation(e: EquipmentItem): string | null {
    const own = e.location?.trim() || null
    if (own) return own
    if (e.assignedToId != null) {
      return memberLocationById.get(e.assignedToId) ?? null
    }
    return null
  }
  const equipmentLocations = Array.from(
    new Set(
      equipment
        .map((e) => effectiveLocation(e))
        .filter((l): l is string => !!l),
    ),
  ).sort()

  // Category sort order = the order CATEGORIES declares them in. Used
  // when "All" is selected so the list groups by category (Panels →
  // WLBP → HWBP → Switches → Antennas → Audio → Mults) instead of
  // jumbling categories together alphabetically by ID.
  const categoryOrder = new Map<string, number>(
    CATEGORIES.map((c, i) => [c.value, i] as const),
  )

  const filteredEquipment = equipment
    .filter((e) => {
      if (eqCategoryFilter && e.category !== eqCategoryFilter) return false
      if (eqLocationFilter && effectiveLocation(e) !== eqLocationFilter) return false
      if (!eqSearch) return true
      const q = eqSearch.toLowerCase()
      return (
        e.name.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        getCategoryLabel(e.category).toLowerCase().includes(q) ||
        (e.hardwareType?.toLowerCase().includes(q) ?? false) ||
        (e.location?.toLowerCase().includes(q) ?? false) ||
        (e.ipAddress?.toLowerCase().includes(q) ?? false) ||
        (e.assignedToName?.toLowerCase().includes(q) ?? false) ||
        (e.assignedToPosition?.toLowerCase().includes(q) ?? false) ||
        e.deployStatus.toLowerCase().includes(q)
      )
    })
    // Sort by category first (matching the chip-row order), then
    // natural-compare by ID inside each category. Deleting /
    // re-numbering / changing an ID (e.g. ANT 5 → ANT 1) still
    // re-orders within its group in real numeric order (ANT 1,
    // ANT 2 … ANT 10). When a specific category chip is active the
    // category-sort is a no-op, so behavior is unchanged there.
    .sort((a, b) => {
      const ca = categoryOrder.get(a.category) ?? Number.MAX_SAFE_INTEGER
      const cb = categoryOrder.get(b.category) ?? Number.MAX_SAFE_INTEGER
      if (ca !== cb) return ca - cb
      return naturalCompare(a.name, b.name)
    })

  // Equipment categories the project actually uses (so chips don't include
  // empty buckets the user has no gear in).
  const usedEquipmentCategories = CATEGORIES.filter((c) =>
    equipment.some((e) => e.category === c.value),
  )

  // ── Inventory tab data: needed counts derived from equipment ──
  // Mirrors the dashboard's derivation so HeadsetInventoryEditor sees the
  // same "X needed" numbers in either location.
  const headsetNeededByType: Record<string, number> = {}
  for (const e of equipment) {
    if (!e.headsetType) continue
    headsetNeededByType[e.headsetType] = (headsetNeededByType[e.headsetType] ?? 0) + 1
  }
  const allPanels = equipment.filter((e) => e.category === 'panels')
  const goosenecksNeeded = allPanels.filter((e) => e.gooseneck).length
  const footswitchesNeeded = allPanels.reduce((s, e) => s + (e.footswitches || 0), 0)
  const speakersNeeded = allPanels.reduce((s, e) => s + (e.speakers || 0), 0)
  // Cable accessories follow the same per-panel derivation as Dashboard:
  //   1/4-XLRM = 1 per footswitch, DB9-XLRF = 1 per panel with footswitches,
  //   RJ45-XLRMF = 1 per speaker.
  const quarterXlrmNeeded = footswitchesNeeded
  const db9XlrfNeeded = allPanels.filter((e) => (e.footswitches || 0) > 0).length
  const rj45XlrmfNeeded = speakersNeeded

  const filteredMembers = project.members
    .filter((m) => {
      if (teamCategoryFilter) {
        // Show members who have at least one piece of gear in the chosen category.
        const memberEqCategories = new Set(
          equipment
            .filter((e) => e.assignedToId === m.id)
            .map((e) => e.category),
        )
        if (!memberEqCategories.has(teamCategoryFilter)) return false
      }
      if (!teamSearch) return true
      const q = teamSearch.toLowerCase()
      // First-login status — same words that appear on the row.
      const status = m.hasPin ? 'active' : 'pending'
      return (
        m.firstName.toLowerCase().includes(q) ||
        m.lastName.toLowerCase().includes(q) ||
        (m.position?.toLowerCase().includes(q) ?? false) ||
        m.role.toLowerCase().includes(q) ||
        // Match equipment auto-names assigned to this member (e.g. "PNL 1",
        // "WLBP 1", "HWBP 2") so an admin can search "PNL" or "HWBP" to
        // find everyone using that gear.
        m.equipmentNames.some((n) => n.toLowerCase().includes(q)) ||
        status.includes(q)
      )
    })
    .sort((a, b) => {
      // Priority 1 — explicit A–Z chip wins over everything: alphabetical by
      // first name regardless of which category is selected.
      if (teamSortAbc) {
        return a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' })
      }

      // Priority 2 — when an assignable category chip is selected and A–Z is
      // off, sort by the equipment ID number for that category. So picking
      // "Panels" lists members in PNL 1, PNL 2, PNL 3 … PNL 10 order.
      if (teamCategoryFilter) {
        const prefix = CATEGORIES.find((c) => c.value === teamCategoryFilter)?.prefix
        if (prefix) {
          const q = prefix.toLowerCase()
          const numA = lowestMatchingEquipmentNum(a.equipmentNames, q)
          const numB = lowestMatchingEquipmentNum(b.equipmentNames, q)
          if (numA != null && numB != null && numA !== numB) return numA - numB
          if (numA != null && numB == null) return -1
          if (numA == null && numB != null) return 1
        }
      }

      // Priority 3 — same logic as before: if the search query mentions an
      // equipment prefix, surface those matches in numeric order first.
      const q = teamSearch.trim().toLowerCase()
      if (q) {
        const numA = lowestMatchingEquipmentNum(a.equipmentNames, q)
        const numB = lowestMatchingEquipmentNum(b.equipmentNames, q)
        if (numA != null && numB != null && numA !== numB) return numA - numB
        if (numA != null && numB == null) return -1
        if (numA == null && numB != null) return 1
      }

      // Default fallback — alphabetical by first name (matches the existing
      // "All" view behavior the user wants preserved).
      return a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' })
    })

  const filteredPickList = pickListItems
    // PTP items are auto-managed (one per user) and aren't user-editable, so
    // they shouldn't clutter the pick list tab.
    .filter((p) => p.type !== 'PTP')
    .filter((p) => {
      if (plTypeFilter && p.type !== plTypeFilter) return false
      if (!plSearch) return true
      const q = plSearch.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        (p.code?.toLowerCase().includes(q) ?? false) ||
        (FUNCTION_TYPE_LABELS[p.type] || p.type).toLowerCase().includes(q) ||
        // Match by user name so searching "John" surfaces every function
        // John has assigned to a key on his panel.
        p.users.some((u) => u.toLowerCase().includes(q))
      )
    })
    // Default sort: by id (creation order) — when a category chip
    // (CONF / IFB / Audio / GRP) is selected the user wants to see
    // items in the order they were added to the project. The A–Z
    // chip flips to natural-sort by name so renames / re-adds
    // reorder the list immediately.
    .sort((a, b) => plSortAbc ? naturalCompare(a.name, b.name) : a.id - b.id)

  const filteredPlots = plots
    .filter((p) =>
      !plotSearch || p.label.toLowerCase().includes(plotSearch.toLowerCase())
    )
    // Natural sort by label so renaming reorders the list.
    .sort((a, b) => naturalCompare(a.label, b.label))

  /* ─── Tab action buttons ─── */

  const tabActionButton = activeTab === 'equipment' ? (
    !showAdd && <Button onClick={() => setShowAdd(true)}><span className="sm:hidden">+</span><span className="hidden sm:inline">Add Equipment</span></Button>
  ) : activeTab === 'team' ? (
    canEditTeam
      ? !showAddMember && <Button onClick={() => setShowAddMember(true)}><span className="sm:hidden">+</span><span className="hidden sm:inline">Add Member</span></Button>
      : isCrew
        ? !showTeamQr && <Button onClick={() => setShowTeamQr(true)}><span className="sm:hidden">+</span><span className="hidden sm:inline">Show QR</span></Button>
        : null
  ) : (
    !showAddPl && <Button onClick={() => setShowAddPl(true)}><span className="sm:hidden">+</span><span className="hidden sm:inline">Add Function</span></Button>
  )

  // Tab list shared by the mobile dropdown (above each tab's content)
  // and the desktop tab dropdown (now sitting to the LEFT of each
  // tab's search input). Computed once here so the same set + counts
  // drive every dropdown instance on the page.
  const myEqCount = equipment.filter((e) => e.assignedMemberId === currentMemberId).length
  const navTabs: { key: Tab; label: string; count: number }[] = isUser
    ? [{ key: 'my-equipment' as Tab, label: 'My Equipment', count: myEqCount }]
    : (() => {
        const list: { key: Tab; label: string; count: number }[] = [
          { key: 'equipment', label: 'Equipment', count: equipment.length },
        ]
        if (isCrew && myEqCount > 0) {
          list.push({ key: 'my-equipment', label: 'My Equipment', count: myEqCount })
        }
        if (!isCrew) {
          list.push({ key: 'team', label: 'Team', count: project.members.length })
          list.push({ key: 'picklist', label: 'Pick List', count: pickListItems.filter((p) => p.type !== 'PTP').length })
        }
        list.push({ key: 'stage-plots', label: 'Plots', count: plots.length })
        // Racks — admin/manager only (same gating as Team / Pick List).
        // Always visible (even with 0 racks) so users can click in to
        // create the first one. Count = racks scoped to this project + dept=comms.
        if (!isCrew) {
          list.push({ key: 'racks', label: 'Racks', count: commsRacks.length })
        }
        return list
      })()
  // Desktop tab dropdown JSX — fixed 280px wide to match the
  // ProjectSwitcher trigger sitting next to it in the page header.
  const desktopTabDropdown = (
    <div className="hidden w-[280px] sm:block">
      <TabsMobileDropdown tabs={navTabs} activeTab={activeTab} onSelect={changeTab} compact />
    </div>
  )

  return (
    <>
      <PageLayout
        title="Comms"
        titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
        inlineAction
        stickyHeader
        bottomBorder
        // Action row: Edit on the left, ProjectSwitcher on the right.
        // The "Projects" back button is gone (the navbar already has a
        // dedicated Projects tab) and the per-tab dropdown moved down
        // next to each tab's search row.
        action={
          // Mobile: kiosk button + project switcher fill the right
          // half of the header row next to the title. Desktop:
          // shrink-0 cluster, switcher's min-w-[280px] kicks in.
          // The kiosk icon sits to the LEFT of the project dropdown
          // and opens the full-screen chassis viewer for this project
          // in a new tab (kiosk-self-check-in flow).
          userProjects.length > 0 ? (
            // Mobile: icons sit OUTSIDE the half-row; only the
            // project dropdown takes exactly half the viewport
            // (w-[calc(50vw-1rem)] accounts for the px-4 page
            // padding). Desktop: switcher's min-w-[280px] kicks in.
            <div className="flex items-center justify-end gap-2">
              {/* Per-tab + (Add) icon button. Tab-aware: opens the
                  appropriate inline add form for the current tab.
                  Sits to the LEFT of the project switcher in the
                  page header so the toolbar rows below don't carry
                  the button anymore. Crew without edit perms on
                  Equipment/Team get a + that opens the join-QR
                  modal (legacy "Show QR" fallback). */}
              {(() => {
                let onClick: (() => void) | null = null
                let ariaLabel = 'Add'
                if (activeTab === 'equipment') {
                  if (canAddEquipment && !showAdd) {
                    onClick = () => setShowAdd(true)
                    ariaLabel = 'Add Equipment'
                  } else if (!canAddEquipment && isCrew && !showTeamQr) {
                    onClick = () => setShowTeamQr(true)
                    ariaLabel = 'Show QR'
                  }
                } else if (activeTab === 'team') {
                  if (canEditTeam && !showAddMember) {
                    onClick = () => setShowAddMember(true)
                    ariaLabel = 'Add Member'
                  } else if (!canEditTeam && isCrew && !showTeamQr) {
                    onClick = () => setShowTeamQr(true)
                    ariaLabel = 'Show QR'
                  }
                } else if (activeTab === 'picklist') {
                  if (canEditPickList && !showAddPl) {
                    onClick = () => setShowAddPl(true)
                    ariaLabel = 'Add Function'
                  }
                } else if (activeTab === 'stage-plots') {
                  if (isAdmin && !showAddPlot) {
                    onClick = () => setShowAddPlot(true)
                    ariaLabel = 'Add Plot'
                  }
                } else if (activeTab === 'racks') {
                  // Per-tab + opens the Create-rack inline form. Same
                  // admin/manager gating as Team / Pick List — the
                  // Racks tab itself isn't shown to crew/user roles.
                  if ((isProjectAdmin || isManager) && !showAddRack) {
                    onClick = () => setShowAddRack(true)
                    ariaLabel = 'Add Rack'
                  }
                }
                if (!onClick) return null
                return (
                  <button
                    type="button"
                    onClick={onClick}
                    aria-label={ariaLabel}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0178a3] text-base font-medium text-white transition-colors hover:bg-[#019bc7]"
                  >
                    +
                  </button>
                )
              })()}
              <div className="w-[calc(50vw-1rem)] sm:w-auto">
                <ProjectSwitcher
                  projectId={project.id}
                  projectName={project.name}
                  userProjects={userProjects}
                  basePath="/projects/:id"
                />
              </div>
            </div>
          ) : null
        }
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {/* ─── Archived banner ─── */}
          {isArchived && (
            <div className="rounded-xl border border-gray-500/30 bg-gray-500/10 px-4 py-3 text-sm text-gray-300">
              <span className="font-semibold text-gray-200">Archived · </span>
              This project is read-only. Everything is preserved for reference;
              editing, submitting changes, and changing deploy statuses are all disabled.
              {isProjectAdmin && (
                <span className="text-gray-300"> Restore it from the Projects list or in the Status dropdown below.</span>
              )}
            </div>
          )}

          {/* Settings Panel lifted to the Projects-list row's
              inline editor — see /projects/project-settings-card.tsx.
              The Comms page no longer renders it; the old block
              below is dead-stripped at compile time via `false`. */}
          {showSettings && false && (
            // mb-4 so the bottom border of the Edit card has the
            // same 16px breathing room below it as the Add cards
            // sitting inside their space-y-3/4 scroll containers.
            <div className="space-y-4 mb-4">
              <Card>
                {/* Top row: heading on the left, PIN centered, close
                    X on the right. The standalone Project PIN card
                    used to live above this — folded in here so admins
                    see one consolidated settings panel. */}
                <div className="relative flex items-center justify-center gap-3">
                  <h3 className="absolute left-0 top-0 text-xl font-bold text-white sm:text-2xl">Project Details</h3>
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    aria-label="Close settings"
                    // Same chip-inactive chrome as the IconButton X
                    // on every other editor card (Add Project,
                    // Add Equipment, etc.) so the close affordance
                    // reads the same everywhere.
                    className="absolute right-0 top-0 flex size-8 items-center justify-center rounded-lg border border-white/10 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
                  >
                    <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <div className="flex flex-col items-center gap-2 pt-10 sm:pt-2">
                    <div className="flex gap-2">
                      {project.pin.split('').map((digit, i) => (
                        <span
                          key={i}
                          className="flex size-10 items-center justify-center rounded-lg border border-white/10 text-lg font-bold text-gray-200"
                        >
                          {digit}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-500">Project PIN — share with your crew so they can join.</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormInput label="Project name" type="text" value={name} onChange={(e) => { setName(e.target.value); setEditError('') }} maxLength={100} />
                  <SearchableSelect
                    label="Manager"
                    value={managerId}
                    placeholder="None"
                    options={[{ value: '', label: 'None' }, ...project.members.map((m) => ({ value: String(m.userId), label: `${m.firstName} ${m.lastName}` }))]}
                    onChange={(v) => setManagerId(v)}
                  />
                </div>
                {/* Archive is admin-only, given its own subsection so it's
                    findable instead of buried as a third dropdown. */}
                {isProjectAdmin && (
                  <div className="mt-5 pt-4">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-white">
                        {status === 'archived' ? 'Restore project' : 'Archive project'}
                      </h4>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {status === 'archived'
                          ? 'Bring this project back to Active so crew can edit equipment again.'
                          : 'Lock the project as read-only after the show wraps. Everything is preserved; you can restore it later.'}
                      </p>
                    </div>
                  </div>
                )}
                {editError && <p className="mt-3 text-sm text-red-400">{editError}</p>}
                {/* Action row — all buttons live here at the bottom-
                    right of the card. Delete on the far left of the
                    cluster, then Archive / Activate Return (chip-
                    inactive look), then Save Changes (cyan primary). */}
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  {isProjectAdmin && (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={isPending}
                      className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                  {isProjectAdmin && (
                    <button
                      type="button"
                      onClick={() => setStatus(status === 'archived' ? 'active' : 'archived')}
                      disabled={isPending}
                      className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {status === 'archived' ? 'Restore' : 'Archive'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleToggleReturnPhase}
                    disabled={returnPending}
                    className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {returnPending ? '...' : returnPhaseActive ? 'Undo Return' : 'Activate Return'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveProject}
                    disabled={isPending}
                    className="rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isPending ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </Card>
            </div>
          )}

          {/* ─── Tab Switcher + per-tab toolbar (mobile only) ─── */}
          {/* Desktop tab dropdown moved into each tab's search row
              (below). Mobile keeps the toolbar here with the dropdown
              on the left + search toggle + per-tab Add on the right.
              Wrapped in AutoHideHeader so it auto-hides on scroll-
              down (Instagram pattern). The TabsMobileDropdown popover
              portals to document.body so the overflow-hidden inside
              AutoHideHeader doesn't clip it when open. */}
          <AutoHideHeader>
          <div>
          <div>
              <>
                {/* Mobile toolbar: tab dropdown + search icon + per-tab
                    Add button. Opening search hides the tab dropdown
                    and the input expands into that space (matches the
                    Radios mobile pattern). Close X collapses back. */}
                <div className="flex items-center gap-2 sm:hidden">
                  {!searchOpen && (
                    <div className="min-w-0 flex-1">
                      <TabsMobileDropdown tabs={navTabs} activeTab={activeTab} onSelect={changeTab} />
                    </div>
                  )}
                  {searchOpen ? (
                    <>
                      <input
                        type="text"
                        autoFocus
                        placeholder={
                          activeTab === 'equipment' ? 'Search equipment...' :
                          activeTab === 'team' ? 'Search team...' :
                          activeTab === 'picklist' ? 'Search functions...' :
                          activeTab === 'stage-plots' ? 'Search plots...' :
                          activeTab === 'racks' ? 'Search racks…' :
                          'Search...'
                        }
                        value={
                          activeTab === 'equipment' ? eqSearch :
                          activeTab === 'team' ? teamSearch :
                          activeTab === 'picklist' ? plSearch :
                          activeTab === 'stage-plots' ? plotSearch :
                          activeTab === 'racks' ? rackSearch : ''
                        }
                        onChange={(e) => {
                          const v = e.target.value
                          if (activeTab === 'equipment') setEqSearch(v)
                          else if (activeTab === 'team') setTeamSearch(v)
                          else if (activeTab === 'picklist') setPlSearch(v)
                          else if (activeTab === 'stage-plots') setPlotSearch(v)
                          else if (activeTab === 'racks') setRackSearch(v)
                        }}
                        className="flex-1 rounded-lg border-2 border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setSearchOpen(false)
                          if (activeTab === 'equipment') setEqSearch('')
                          else if (activeTab === 'team') setTeamSearch('')
                          else if (activeTab === 'picklist') setPlSearch('')
                          else if (activeTab === 'stage-plots') setPlotSearch('')
                          else if (activeTab === 'racks') setRackSearch('')
                        }}
                        aria-label="Close search"
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
                      >
                        <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </>
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
                  {/* Per-tab + (Add) icon button moved into the page
                      header (left of the project switcher) so the
                      toolbar row only carries the search affordance. */}
                </div>
                {/* Desktop tab strip removed — desktop now uses
                    the same dropdown component as mobile, rendered
                    next to each tab's search input below. */}
              </>
          </div>{/* /tab strip wrapper */}
          </div>{/* /tab + toolbar row */}
          </AutoHideHeader>

          {/* Removed: desktop divider that used to sit below the
              tab + toolbar row. The page header's bottomBorder is
              now the only horizontal separator above per-tab content
              so the page doesn't carry two stacked dividers. */}

          {/* ═══════════════════════════════ EQUIPMENT TAB ═══════════════════════════════ */}
          {activeTab === 'equipment' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Mobile-only sticky bundle: search + filter chips ride
                  together. Desktop search+add is in the top toolbar.
                  Wrapped in AutoHideHeader so on mobile the toolbar
                  collapses on scroll-down + restores on scroll-up
                  (Instagram / Facebook pattern). */}
              <AutoHideHeader className="-mx-4 bg-[#202020] sm:-mx-6 lg:-mx-8">
              <div className="px-4 pt-3 sm:px-6 lg:px-8">
                {/* Search + Add moved into the tab dropdown row above
                    on mobile (search icon toggles a collapsible
                    input). */}
                {/* Mobile-only divider line — sits between the search row
                    and the filter chips (matches the desktop divider's
                    role of separating toolbar from per-tab content). */}
{/* removed — page-header bottomBorder serves as the toolbar / content divider now */}

              {/* Filter dropdowns (left) + desktop search + add button
                  (right). Category + Location pickers are now native
                  dropdowns instead of horizontal chip scrollers — same
                  pattern on mobile and desktop. Side-by-side via flex
                  with equal widths so neither dominates. */}
              <div className="pb-3 sm:flex sm:items-center sm:gap-3">
                {(usedEquipmentCategories.length > 0 || equipmentLocations.length > 0) ? (
                  // sm:flex-1 still pushes the desktop search + Add
                  // button to the right edge; the dropdowns inside
                  // hug the LEFT thanks to their fixed width + the
                  // flex container's default left alignment.
                  <div className="flex gap-2 sm:flex-1">
                    {/* Mobile: each dropdown takes 50% of the row
                        via flex-1. Desktop: snap back to fixed chip
                        width (w-36) left-aligned. */}
                    {usedEquipmentCategories.length > 0 && (
                      <FilterDropdown
                        ariaLabel="Filter by category"
                        widthClass="min-w-0 flex-1 sm:flex-none sm:w-36 sm:shrink-0"
                        value={eqCategoryFilter ?? ''}
                        onChange={(v) => setEqCategoryFilter(v || null)}
                        options={[
                          { value: '', label: 'All categories' },
                          ...usedEquipmentCategories.map((c) => ({
                            value: c.value,
                            label: c.label,
                          })),
                        ]}
                      />
                    )}
                    {equipmentLocations.length > 0 && (
                      <FilterDropdown
                        ariaLabel="Filter by location"
                        widthClass="min-w-0 flex-1 sm:flex-none sm:w-36 sm:shrink-0"
                        value={eqLocationFilter ?? ''}
                        onChange={(v) => setEqLocationFilter(v || null)}
                        options={[
                          { value: '', label: 'All locations' },
                          ...equipmentLocations.map((loc) => ({
                            value: loc,
                            label: loc,
                          })),
                        ]}
                      />
                    )}
                  </div>
                ) : (
                  <div className="sm:flex-1" />
                )}
                {/* Desktop-only: tab dropdown + collapsible search +
                    Add button. Search starts as a magnifier icon (like
                    mobile); tapping it expands the input inline and
                    swaps the icon to an X that closes it. Input
                    autoFocuses when opened. */}
                <div className="hidden items-center gap-2 sm:flex">
                  {!searchOpen && desktopTabDropdown}
                  {searchOpen ? (
                    <>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Search equipment..."
                        value={eqSearch}
                        onChange={(e) => setEqSearch(e.target.value)}
                        className="w-[280px] rounded-lg border-2 border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
                      />
                      <button
                        type="button"
                        onClick={() => { setSearchOpen(false); setEqSearch('') }}
                        aria-label="Close search"
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
                      >
                        <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </>
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
                  {/* + Add moved into the page header. */}
                </div>
              </div>
              </div>{/* /sticky bundle */}

              {/* Count text — pinned above the scroll on desktop.
                  Two formats:
                  • When filtering by location, the used/unused split
                    isn't meaningful (everything in a location is in
                    use there), so we just show the row count.
                  • Otherwise, show {used} of {total} used · {unused}
                    unused so the operator can see the utilization
                    breakdown at a glance. Both formats respect the
                    active category + search filter. */}
              <div className="px-4 sm:px-6 lg:px-8">
              {(() => {
                const total = filteredEquipment.length
                if (eqLocationFilter) {
                  return (
                    <p className="text-xs flex-shrink-0 pt-1 pb-2 text-gray-500">
                      {total} item{total === 1 ? '' : 's'}
                      {eqSearch && ` matching "${eqSearch}"`}
                    </p>
                  )
                }
                const used = filteredEquipment.filter(isEquipmentUsed).length
                const unused = total - used
                return (
                  <p className="text-xs flex-shrink-0 pt-1 pb-2 text-gray-500">
                    {used} of {total} used · {unused} unused
                    {eqSearch && ` matching "${eqSearch}"`}
                  </p>
                )
              })()}
              </div>
              </AutoHideHeader>

              {/* Scrollable list region. The Pull List card lives INSIDE
                  the scroll so picking a location doesn't pin a tall card
                  above the cards on mobile. */}
              <div data-scroll-container className="flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto overscroll-none pt-2 pb-4 sm:pb-20">
              {/* Join-QR card was lifted out into a Modal at the
                  page root so the QR icon in the header opens it on
                  any tab (not just Equipment). The Card render here
                  is gone. */}
              {/* Bulk add card lives INSIDE the scroll so the form
                  doesn't pin above the list and steal vertical space —
                  scrolls naturally with the rest of the tab content.
                  Mode switch lives in a dropdown chip to the left of
                  the close X — Equipment (default) vs Headsets & Misc. */}
              {canAddEquipment && showAdd && (
                <Card>
                  {/* Header row — on desktop the explanation text
                      sits to the LEFT of the dropdown + X. On mobile
                      the dropdown row is on top and the explanation
                      drops to the next line so the dropdown can take
                      the full width. */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    {addTab === 'equipment' && (
                      <p className="order-2 text-xs text-gray-500 sm:order-1 sm:flex-1">
                        Add equipment. Each item auto-IDs by category (<span className="font-mono">PNL 1</span>, <span className="font-mono">WLBP 1</span>…). Type an ID to customize.
                      </p>
                    )}
                    {addTab === 'inventory' && (
                      <div className="order-2 sm:order-1 sm:flex-1 sm:min-w-0">
                        <div className="text-base font-semibold text-white">Manage Inventory</div>
                        <div className="mt-0.5 text-xs text-gray-500">How many of each you packed for this show</div>
                      </div>
                    )}
                    {addTab === 'mults' && (
                      <p className="order-2 text-xs text-gray-500 sm:order-1 sm:flex-1">
                        Add mults. Each gets its own card with a strand list. IDs auto-letter per type — <span className="font-mono">FBR A</span>, <span className="font-mono">ETH B</span>, <span className="font-mono">W1 C</span>, <span className="font-mono">CPC D</span>.
                      </p>
                    )}
                    <div className="order-1 flex items-center justify-end gap-2 sm:order-2">
                      <AddTabSwitcher value={addTab} onChange={setAddTab} />
                    </div>
                  </div>

                  {addTab === 'equipment' ? (
                    <>
                      <form onSubmit={(e) => { e.preventDefault(); handleBulkAdd() }}>
                        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                          <FormInput
                            label="ID"
                            type="text"
                            placeholder="Auto"
                            value={addEquipmentId}
                            onChange={(e) => setAddEquipmentId(e.target.value)}
                          />
                          <SearchableSelect
                            label="Category"
                            value={addCategory}
                            placeholder="Select..."
                            options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
                            onChange={(v) => setAddCategory(v)}
                          />
                          <SearchableSelect
                            label="Hardware type"
                            value={addHardwareType}
                            placeholder="None"
                            options={[{ value: '', label: 'None' }, ...(HARDWARE_TYPES[addCategory] || []).map((ht) => ({ value: ht, label: ht }))]}
                            onChange={(v) => setAddHardwareType(v)}
                          />
                          <FormInput label="Quantity" type="text" inputMode="numeric" pattern="[0-9]*" value={addQuantity}
                            onChange={(e) => { const val = e.target.value.replace(/\D/g, ''); setAddQuantity(val) }} />
                          <SearchableSelect
                            label="Auto Team Assign"
                            // Auto-creating a placeholder team member only
                            // makes sense for categories that can have a
                            // person assigned (panels, beltpacks). Lock
                            // the field for chargers / switches / etc.
                            disabled={!isAssignable(addCategory)}
                            value={!isAssignable(addCategory) ? 'no' : (addAutoAssign ? 'yes' : 'no')}
                            placeholder="Select..."
                            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                            onChange={(v) => setAddAutoAssign(v === 'yes')}
                          />
                        </div>
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                          <button type="button" onClick={() => { setShowAdd(false); setAddError('') }} disabled={isPending} className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Cancel</button>
                          <Button type="submit" disabled={isPending} className="w-full sm:w-auto">{isPending ? 'Adding...' : 'Add'}</Button>
                        </div>
                        {addError && <p className="mt-3 text-sm text-red-400">{addError}</p>}
                      </form>
                    </>
                  ) : addTab === 'inventory' ? (
                    <div className="mt-3">
                      <HeadsetInventoryEditor
                        projectId={project.id}
                        initial={headsetInventory}
                        needed={headsetNeededByType}
                        miscInitial={miscInventory}
                        miscNeeded={{
                          goosenecks: goosenecksNeeded,
                          footswitches: footswitchesNeeded,
                          speakers: speakersNeeded,
                          quarterXlrm: quarterXlrmNeeded,
                          db9Xlrf: db9XlrfNeeded,
                          rj45Xlrmf: rj45XlrmfNeeded,
                        }}
                        onDone={() => setShowAdd(false)}
                      />
                    </div>
                  ) : (
                    // ─── Mults add form ───
                    // Three inputs (Hardware Type / Strand Count for Fiber /
                    // Quantity). Strand count only renders for Fiber; the
                    // other types are fixed (Ethernet=5, W1=16, CPC=4).
                    <form onSubmit={(e) => { e.preventDefault(); handleMultBulkAdd() }}>
                      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                        <SearchableSelect
                          label="Hardware"
                          value={addMultHardwareType}
                          placeholder="Select..."
                          options={MULT_HARDWARE_TYPES.map((t) => ({ value: t, label: t }))}
                          onChange={(v) => {
                            const next = v as MultHardwareType
                            setAddMultHardwareType(next)
                            // Reset strand count to the Fiber default when
                            // flipping back to Fiber; the count input itself
                            // hides for the other types so the stored value
                            // doesn't matter for them.
                            if (next === 'Fiber') setAddMultStrandCount(FIBER_DEFAULT_STRANDS)
                          }}
                        />
                        {addMultHardwareType === 'Fiber' && (
                          <SearchableSelect
                            label="Strands"
                            value={String(addMultStrandCount)}
                            placeholder="Select..."
                            options={FIBER_STRAND_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
                            onChange={(v) => setAddMultStrandCount(parseInt(v, 10) || FIBER_DEFAULT_STRANDS)}
                          />
                        )}
                        <SearchableSelect
                          label="Length"
                          value={String(addMultLength)}
                          placeholder="Select..."
                          options={MULT_LENGTH_OPTIONS.map((n) => ({ value: String(n), label: `${n}'` }))}
                          onChange={(v) => setAddMultLength(parseInt(v, 10) || MULT_DEFAULT_LENGTH)}
                        />
                        <FormInput
                          label="Quantity"
                          type="number"
                          min={1}
                          max={200}
                          value={addMultQuantity}
                          onChange={(e) => setAddMultQuantity(e.target.value)}
                        />
                      </div>
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                        <button
                          type="button"
                          onClick={() => { setShowAdd(false); setAddError('') }}
                          disabled={isPending}
                          className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                        >
                          Cancel
                        </button>
                        <Button type="submit" size="sm" disabled={isPending} className="w-full sm:w-auto">{isPending ? 'Adding…' : 'Add'}</Button>
                      </div>
                      {addError && <p className="mt-3 text-sm text-red-400">{addError}</p>}
                    </form>
                  )}
                </Card>
              )}
              {eqLocationFilter && (
                <LocationSummary
                  location={eqLocationFilter}
                  allGear={equipment.map((e) => ({
                    id: e.id,
                    name: e.name,
                    category: e.category,
                    hardwareType: e.hardwareType,
                    headsetType: e.headsetType,
                    effectiveLocation: effectiveLocation(e),
                    gooseneck: e.gooseneck,
                    footswitches: e.footswitches,
                    speakers: e.speakers,
                    deployStatus: e.deployStatus,
                  }))}
                  plots={plots}
                  onRename={
                    canEditTeam
                      ? async (nextName) => {
                          const res = await renameLocation(project.id, eqLocationFilter, nextName)
                          if (res.error) { showToast('error', res.error); return { error: res.error } }
                          // Keep the filter chip pointing at the renamed
                          // location so the card stays open on the same
                          // gear after the rename completes.
                          setEqLocationFilter(nextName.trim())
                          showToast('success', `Renamed ${eqLocationFilter} → ${nextName.trim()}`)
                        }
                      : undefined
                  }
                />
              )}
              {filteredEquipment.length === 0 ? (
                <EmptyState icon={<WrenchIcon />} title={eqSearch ? 'No matches found' : 'No equipment yet'} message={eqSearch ? 'Try a different search term.' : 'Add equipment using the button above.'} />
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {/* Pre-compute the "gear already attached to another
                      mult's strand" set so each MultRow can hide those
                      from its attach dropdown (1:1 wiring rule). */}
                  {(() => null)()}
                  {filteredEquipment.map((item) => {
                    const isEditing = editingEqId === item.id

                    // Mults: when NOT editing, render the read-only
                    // header (no chevron). When editing, the regular
                    // equipment edit form renders below (further down
                    // in this map) and a strand list is appended via
                    // MultStrandList right after the form.
                    if (item.category === 'mults' && !isEditing) {
                      return (
                        <MultRowHeader
                          key={item.id}
                          mult={{
                            id: item.id,
                            name: item.name,
                            hardwareType: item.hardwareType,
                            location: item.location,
                            lengthFeet: item.lengthFeet,
                            strands: item.strands,
                          }}
                          canEdit={canEditEquipment}
                          onEdit={() => startEqEdit(item)}
                        />
                      )
                    }

                    return (
                      <div key={item.id} className={`flex flex-col items-stretch gap-4 py-3 transition-colors sm:flex-row sm:items-start sm:gap-4 ${isEditing ? '' : 'hover:bg-white/[0.04]'}`}>
                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <form
                              data-edit-form="equipment"
                              data-card-id={item.id}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  e.preventDefault()
                                  setEditingEqId(null)
                                  setChainTarget(null)
                                }
                              }}
                              onSubmit={(e) => { e.preventDefault(); handleSaveEquipment(item) }}>
                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <FormInput compact label="ID" type="text" value={(editEqData.name as string) || ''} onChange={(e) => setEditEqData({ ...editEqData, name: e.target.value })} />
                                {/* Antenna-only free-form "Name" — e.g.
                                    "FOH Bolero", "PLHQ 2.4". Surfaces
                                    on the card header above the ANT N
                                    ID so the rack reads in human
                                    language. */}
                                {hasField(item.category, 'position') && (
                                  <FormInput compact label="Name" type="text" value={(editEqData.position as string) || ''} onChange={(e) => setEditEqData({ ...editEqData, position: e.target.value })} />
                                )}
                                <SearchableSelect
                                  compact
                                  label="Hardware"
                                  value={(editEqData.hardwareType as string) || ''}
                                  placeholder="None"
                                  options={[{ value: '', label: 'None' }, ...(HARDWARE_TYPES[item.category] || []).map((ht) => ({ value: ht, label: ht }))]}
                                  onChange={(v) => {
                                    // Auto-pick the matching headset for DBP4/DBP5 selections.
                                    const autoHeadset =
                                      v === 'DBP4' ? 'LWHS 4' : v === 'DBP5' ? 'LWHS 5' : null
                                    // Pre-fill the IP field with the network prefix for known
                                    // hardware (Riedel panels -> 10.240., switches -> 10.249.)
                                    // ONLY when the row doesn't already have an IP set, so we
                                    // never overwrite existing entries.
                                    const currentIp = (editEqData.ipAddress as string) || ''
                                    const prefixForHardware = v ? IP_PREFIX_BY_HARDWARE[v] : undefined
                                    const autoIp =
                                      prefixForHardware && !currentIp.trim()
                                        ? prefixForHardware
                                        : undefined
                                    setEditEqData({
                                      ...editEqData,
                                      hardwareType: v || null,
                                      ...(autoHeadset ? { headsetType: autoHeadset } : {}),
                                      ...(autoIp ? { ipAddress: autoIp } : {}),
                                    })
                                  }}
                                />
                                {hasField(item.category, 'headsetType') && (
                                  <SearchableSelect
                                    compact
                                    label="Headset"
                                    value={(editEqData.headsetType as string) || ''}
                                    placeholder="None"
                                    options={[{ value: '', label: 'None' }, ...HEADSET_TYPES.map((ht) => ({ value: ht, label: ht }))]}
                                    onChange={(v) => setEditEqData({ ...editEqData, headsetType: v || null })}
                                  />
                                )}
                                {hasField(item.category, 'location') && (
                                  <ComboboxInput
                                    compact
                                    label="Location"
                                    value={(editEqData.location as string) || ''}
                                    options={allLocations}
                                    onChange={(v) => setEditEqData({ ...editEqData, location: v })}
                                  />
                                )}
                                {hasField(item.category, 'ipAddress', editEqData.hardwareType as string | null) && (
                                  // inputMode="decimal" surfaces the
                                  // numeric+dot keypad on iOS / Android
                                  // for IP entry. pattern keeps the
                                  // value to digits-and-dots only.
                                  <FormInput
                                    compact
                                    label="IP Address"
                                    type="text"
                                    inputMode="decimal"
                                    pattern="[0-9.]*"
                                    autoComplete="off"
                                    value={(editEqData.ipAddress as string) || ''}
                                    onChange={(e) => setEditEqData({ ...editEqData, ipAddress: e.target.value })}
                                  />
                                )}
                                {hasField(item.category, 'patch') && (
                                  <FormInput compact label="Patch" type="text" value={(editEqData.patch as string) || ''} onChange={(e) => setEditEqData({ ...editEqData, patch: e.target.value })} />
                                )}
                                {/* Mult-only strand count — Fiber only.
                                    Ethernet/W1/CPC have fixed strand
                                    counts per their hardware spec, so
                                    the field is hidden for those. */}
                                {hasField(item.category, 'strandCount', editEqData.hardwareType as string | null) && (
                                  <SearchableSelect
                                    compact
                                    label="Strands"
                                    value={editEqData.strandCount == null ? '' : String(editEqData.strandCount)}
                                    placeholder="Select…"
                                    options={FIBER_STRAND_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
                                    onChange={(v) => setEditEqData({ ...editEqData, strandCount: v ? parseInt(v, 10) : null })}
                                  />
                                )}
                                {/* Mult-only length dropdown. Physical
                                    cable length in feet. */}
                                {hasField(item.category, 'lengthFeet') && (
                                  <SearchableSelect
                                    compact
                                    label="Length"
                                    value={editEqData.lengthFeet == null ? '' : String(editEqData.lengthFeet)}
                                    placeholder="None"
                                    options={[
                                      { value: '', label: 'None' },
                                      ...MULT_LENGTH_OPTIONS.map((n) => ({ value: String(n), label: `${n}'` })),
                                    ]}
                                    onChange={(v) => setEditEqData({ ...editEqData, lengthFeet: v ? parseInt(v, 10) : null })}
                                  />
                                )}
                                {/* Mult-only trunk dropdown. Options are
                                    switches and Pliant antennas — the
                                    only valid trunk endpoints. */}
                                {/* Trunk dropdown removed — wiring is
                                    recorded per strand via the attach
                                    dropdown inside the strand list
                                    below. */}
                                {isAssignable(item.category) && (
                                  <SearchableSelect
                                    compact
                                    label="Assigned to"
                                    value={String(editEqData.assignedToId || '')}
                                    placeholder="Unassigned"
                                    options={[{ value: '', label: 'Unassigned' }, ...assignableMembers.map((m) => ({ value: String(m.id), label: m.name }))]}
                                    onChange={(v) => setEditEqData({ ...editEqData, assignedToId: v ? parseInt(v) : null })}
                                  />
                                )}
                                {/* Panel-only misc accessories */}
                                {item.category === 'panels' && (
                                  <>
                                    <SearchableSelect
                                      compact
                                      label="Gooseneck"
                                      value={editEqData.gooseneck ? 'yes' : 'no'}
                                      options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
                                      onChange={(v) => setEditEqData({ ...editEqData, gooseneck: v === 'yes' })}
                                    />
                                    <SearchableSelect
                                      compact
                                      label="Footswitches"
                                      value={String(editEqData.footswitches ?? 0)}
                                      options={[
                                        { value: '0', label: 'None' },
                                        { value: '1', label: '1' },
                                        { value: '2', label: '2' },
                                        { value: '3', label: '3' },
                                      ]}
                                      onChange={(v) => setEditEqData({ ...editEqData, footswitches: parseInt(v) || 0 })}
                                    />
                                    <SearchableSelect
                                      compact
                                      label="Speakers"
                                      value={String(editEqData.speakers ?? 0)}
                                      options={[
                                        { value: '0', label: 'None' },
                                        { value: '1', label: '1' },
                                        { value: '2', label: '2' },
                                      ]}
                                      onChange={(v) => setEditEqData({ ...editEqData, speakers: parseInt(v) || 0 })}
                                    />
                                  </>
                                )}
                              </div>
                              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                                <button type="button" onClick={() => handleDeleteEquipment(item)} disabled={isPending} className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Delete</button>
                                <button type="button" onClick={() => setEditingEqId(null)} disabled={isPending} className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Cancel</button>
                                <Button type="submit" size="sm" disabled={isPending} className="w-full sm:w-auto">Save</Button>
                              </div>
                              {/* Mult-only: strand / pair list appears
                                  inline under the edit form action row,
                                  inside the same edit container. Each
                                  strand auto-saves channel name + attach
                                  independently of the equipment Save. */}
                              {item.category === 'mults' && (() => {
                                const attachedElsewhere = new Set<number>()
                                for (const m of equipment) {
                                  if (m.category !== 'mults' || m.id === item.id) continue
                                  if (m.hardwareType !== item.hardwareType) continue
                                  for (const s of m.strands) {
                                    if (s.attachedEquipmentId != null) attachedElsewhere.add(s.attachedEquipmentId)
                                  }
                                }
                                const lookup = equipment.map((e) => ({
                                  id: e.id,
                                  name: e.name,
                                  category: e.category,
                                  hardwareType: e.hardwareType,
                                  position: e.position,
                                  location: e.location,
                                }))
                                return (
                                  <MultStrandList
                                    projectId={project.id}
                                    mult={{ id: item.id, hardwareType: item.hardwareType, strands: item.strands }}
                                    allEquipment={lookup}
                                    attachedElsewhere={attachedElsewhere}
                                  />
                                )
                              })()}
                            </form>
                          ) : (
                            <>
                              {/* Row 1: ID — on mobile stacks assignee below; on desktop stays inline */}
                              <div className="text-sm font-semibold">
                                {/* Equipment name */}
                                {['panels', 'hardwire_bp', 'wireless_bp'].includes(item.category) ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isCrew && item.assignedMemberId === currentMemberId) {
                                        changeTab('my-equipment')
                                      } else {
                                        router.push(`/projects/${project.id}/panel/${item.id}`)
                                      }
                                    }}
                                    className={`transition-colors duration-500 hover:underline decoration-current/30 hover:decoration-current ${item.ipAddress && reachable[item.id] ? 'text-green-400' : 'text-white'}`}
                                    title={isCrew && item.assignedMemberId === currentMemberId
                                      ? 'Click to view in My Equipment'
                                      : item.ipAddress && reachable[item.id] ? `${item.ipAddress} — reachable · Click to open Panel Studio` : 'Click to open Panel Studio'}
                                  >
                                    {item.name}
                                  </button>
                                ) : (
                                  <>
                                    <span
                                      className={`transition-colors duration-500 ${item.ipAddress && reachable[item.id] ? 'text-green-400' : 'text-white'}`}
                                      title={item.ipAddress && reachable[item.id] ? `${item.ipAddress} — reachable` : undefined}
                                    >
                                      {item.name}
                                    </span>
                                    {/* Antennas: free-form "Name"
                                        (position field) sits to the
                                        right of the ANT N ID in cyan
                                        — same accent treatment as the
                                        assignee inline label. */}
                                    {hasField(item.category, 'position') && item.position && (
                                      <>
                                        <span className="text-gray-500"> · </span>
                                        <span className="text-[#22a7d3]">{item.position}</span>
                                      </>
                                    )}
                                    {/* Switches: surface the location
                                        next to the SW N ID in cyan
                                        too — racks identify by where
                                        they live, not the auto-ID. */}
                                    {item.category === 'switches' && item.location && (
                                      <>
                                        <span className="text-gray-500"> · </span>
                                        <span className="text-[#22a7d3]">{item.location}</span>
                                      </>
                                    )}
                                  </>
                                )}
                                {/* Assignee — always inline with the ID
                                    so the identity strip (ID · Name ·
                                    Department · Position) sits on a
                                    single row at the top of the card on
                                    both mobile and desktop. Wraps as
                                    needed if the name is long. */}
                                {item.assignedToName ? (
                                  <>
                                    <span className="text-gray-500"> · </span>
                                    <span className="text-[#22a7d3]">
                                      {item.assignedToName}
                                      {item.assignedToDepartment && <span className="text-[#22a7d3]/70"> · {item.assignedToDepartment}</span>}
                                      {item.assignedToPosition && <span className="text-[#22a7d3]/70"> · {item.assignedToPosition}</span>}
                                    </span>
                                  </>
                                ) : isAssignable(item.category) ? (
                                  <>
                                    <span className="text-gray-500"> · </span>
                                    <span className="italic text-gray-400">Unassigned</span>
                                  </>
                                ) : null}
                              </div>

                              {/* Row 2: details — wrapping inline chips
                                  on both mobile and desktop. Each chip
                                  bundles its label + value in a single
                                  whitespace-nowrap span so the pair
                                  never gets split across wrap rows
                                  (e.g. "IP: 192.168.1.5" stays glued).
                                  Switches still hide their location
                                  here (shown next to the ID above). */}
                              <div className="mt-1 text-sm text-gray-300">
                                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                  {item.location && item.category !== 'switches' && <span className="whitespace-nowrap"><span className="text-xs text-gray-500">Location: </span>{item.location}<span className="ml-1.5 text-gray-500">·</span></span>}
                                  {item.hardwareType && <span className="whitespace-nowrap"><span className="text-xs text-gray-500">Hardware: </span>{item.hardwareType}</span>}
                                  {item.headsetType && <span className="whitespace-nowrap"><span className="text-gray-500">· </span><span className="text-xs text-gray-500">Headset: </span>{item.headsetType}</span>}
                                  {item.ipAddress && <span className="whitespace-nowrap"><span className="text-gray-500">· </span><span className="text-xs text-gray-500">IP: </span><a href={`http://${item.ipAddress}${item.category === 'panels' ? '/remote-control/' : ''}`} target="_blank" rel="noopener noreferrer" className="text-[#22a7d3] hover:text-[#019bc7]">{item.ipAddress}</a></span>}
                                  {item.patch && item.category !== 'switches' && <span className="whitespace-nowrap"><span className="text-gray-500">· </span><span className="text-xs text-gray-500">Patch: </span><span className="font-mono">{item.patch}</span></span>}
                                  {item.gooseneck && <span className="whitespace-nowrap"><span className="text-gray-500">· </span>Gooseneck</span>}
                                  {item.footswitches > 0 && <span className="whitespace-nowrap"><span className="text-gray-500">· </span><span className="text-xs text-gray-500">FS: </span>{item.footswitches}</span>}
                                  {item.speakers > 0 && <span className="whitespace-nowrap"><span className="text-gray-500">· </span><span className="text-xs text-gray-500">SPK: </span>{item.speakers}</span>}
                                </div>
                              </div>
                              {/* Mult patches — every mult strand that
                                  points AT this Equipment row. Only
                                  surfaces on switches and Pliant
                                  antennas (the trunk-end devices that
                                  mults plug into). Suffix is "strand"
                                  for Fiber mults and "pair" for the
                                  copper types (Ethernet / W1 / CPC).
                                  Channel name shows as a hover tooltip. */}
                              {item.attachedStrands.length > 0
                                && (item.category === 'switches'
                                  || (item.category === 'antennas' && item.hardwareType === 'Pliant'))
                                && (
                                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-400">
                                    <span className="text-xs text-gray-500">Patched: </span>
                                    {item.attachedStrands.map((s, i) => {
                                      const unit = s.multHardwareType === 'Fiber' ? 'Strand' : 'Pair'
                                      return (
                                        <span key={s.id} title={s.channelName || undefined}>
                                          <span className="text-[#22a7d3]">{s.multName} {unit} {s.index}</span>
                                          {i < item.attachedStrands.length - 1 && <span className="text-gray-500"> · </span>}
                                        </span>
                                      )
                                    })}
                                  </div>
                                )}
                            </>
                          )}
                        </div>

                        {/* Status + Edit (or single "Mark returned"
                            during return phase). When the project's
                            in return phase AND this row isn't already
                            returned/damaged, the Status dropdown +
                            Edit button collapse into ONE primary cyan
                            button. Click → status flips to RETURNED;
                            row reverts to normal display next render
                            because it no longer matches the gate. */}
                        {!isEditing && (() => {
                          const inReturnFlow =
                            returnPhaseActive &&
                            item.deployStatus !== 'returned' &&
                            item.deployStatus !== 'damaged' &&
                            canChangeStatus
                          if (inReturnFlow) {
                            return (
                              <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0 sm:items-center">
                                <button
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => {
                                    startTransition(async () => {
                                      const result = await updateEquipment(project.id, item.id, { deployStatus: 'returned' })
                                      if (result.error) { showToast('error', result.error); return }
                                      router.refresh()
                                    })
                                  }}
                                  className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:opacity-50 sm:w-auto"
                                >
                                  Returned
                                </button>
                              </div>
                            )
                          }
                          return (
                            <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0 sm:items-center">
                              {canChangeStatus ? (
                                <div className="flex w-full items-center gap-1.5 sm:w-auto">
                                  <span className="hidden text-[10px] font-medium text-gray-400 sm:inline">Status</span>
                                  <DeployStatusSelect
                                    value={item.deployStatus}
                                    className="w-full sm:w-auto"
                                    onChange={(newStatus) => {
                                      startTransition(async () => {
                                        const result = await updateEquipment(project.id, item.id, { deployStatus: newStatus })
                                        if (result.error) { showToast('error', result.error); return }
                                        router.refresh()
                                      })
                                    }}
                                  />
                                </div>
                              ) : (
                                <span className={`inline-flex w-full items-center gap-2 rounded-lg border ${STATUS_BORDER_STYLES[item.deployStatus] || STATUS_BORDER_STYLES.na} px-4 py-2 text-sm font-medium text-gray-200 sm:w-auto`}>
                                  <span className="min-w-[4.5rem]">{getStatusLabel(item.deployStatus)}</span>
                                </span>
                              )}
                              {canEditEquipment && <button type="button" data-edit-button={`equipment-${item.id}`} onClick={() => startEqEdit(item)} className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white sm:w-auto">Edit</button>}
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              )}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════ TEAM TAB ═══════════════════════════════ */}
          {activeTab === 'team' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Mobile-only sticky bundle — wrapped in AutoHideHeader
                  so it collapses on scroll-down with the page header. */}
              <AutoHideHeader className="-mx-4 bg-[#202020] sm:-mx-6 lg:-mx-8">
              <div className="px-4 pt-3 sm:px-6 lg:px-8">
                {/* Search + Add moved into the tab dropdown row above
                    on mobile. */}
                {/* Mobile-only divider line below the search row. */}
{/* removed — page-header bottomBorder serves as the toolbar / content divider now */}

                {/* Filter chips (left) + desktop search + add (right). */}
                <div className="pb-3 sm:flex sm:items-center sm:gap-3">
                  {!isCrew && (() => {
                    const cats = usedEquipmentCategories.filter((c) => c.assignable)
                    if (cats.length === 0) return <div className="sm:flex-1" />
                    return (
                      // sm:flex-1 keeps the desktop search/Add buttons
                      // anchored right; the dropdown + A-Z chip sit
                      // far-left.
                      <div className="flex items-center gap-2 sm:flex-1">
                        {/* Dropdown takes half the row on mobile; the
                            A-Z toggle keeps its compact chip size.
                            Desktop reverts to the fixed chip width. */}
                        <FilterDropdown
                          ariaLabel="Filter by category"
                          widthClass="w-1/2 sm:w-36 sm:shrink-0"
                          value={teamCategoryFilter ?? ''}
                          onChange={(v) => setTeamCategoryFilter(v || null)}
                          options={[
                            { value: '', label: 'All categories' },
                            ...cats.map((c) => ({ value: c.value, label: c.label })),
                          ]}
                        />
                        <Chip active={teamSortAbc} onClick={() => setTeamSortAbc(!teamSortAbc)}>
                          A–Z
                        </Chip>
                      </div>
                    )
                  })()}
                  {/* Desktop tab dropdown + collapsible search + Add
                      member. Search icon ↔ input toggle same as the
                      Equipment tab pattern above. */}
                  <div className="hidden items-center gap-2 sm:flex">
                    {!searchOpen && desktopTabDropdown}
                    {searchOpen ? (
                      <>
                        <input
                          type="text"
                          autoFocus
                          placeholder="Search team..."
                          value={teamSearch}
                          onChange={(e) => setTeamSearch(e.target.value)}
                          className="w-[280px] rounded-lg border-2 border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
                        />
                        <button
                          type="button"
                          onClick={() => { setSearchOpen(false); setTeamSearch('') }}
                          aria-label="Close search"
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
                        >
                          <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </>
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
                    {/* + Add moved into the page header. */}
                  </div>
                </div>
              </div>{/* /sticky bundle */}

              {/* Count text — pinned above the scroll on desktop. */}
              <div className="px-4 sm:px-6 lg:px-8">
              <p className="text-xs flex-shrink-0 pt-1 pb-2 text-gray-500">
                {filteredMembers.length} of {project.members.length} members
                {teamSearch && ` matching "${teamSearch}"`}
              </p>
              </div>
              </AutoHideHeader>

              {/* Scrollable list region (desktop). Add Member card lives
                  INSIDE so it scrolls with the team list instead of
                  pinning above and stealing vertical space. */}
              <div data-scroll-container className="space-y-3 flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto overscroll-none pt-2 pb-4 sm:pb-20">
              {/* Crew-only: standalone join-QR card. Lives inside the
                  scroll like the Add Member card. */}
              {isCrew && showTeamQr && (
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Join QR</h3>
                    <IconButton onClick={() => setShowTeamQr(false)}><CloseIcon /></IconButton>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Show this to crew during gear deployment. Scanning pre-fills the project PIN; existing users will sign in, new users will create their PIN.</p>
                  {(() => {
                    const joinUrl = `https://versacom-app.vercel.app/login/join?pin=${project.pin}`
                    return (
                      <div className="mt-4 flex flex-col items-center gap-3">
                        <div className="rounded-xl bg-white p-3">
                          <QRCodeSVG value={joinUrl} size={220} level="M" />
                        </div>
                        <span className="font-mono text-[11px] text-gray-400 break-all text-center">{joinUrl}</span>
                      </div>
                    )
                  })()}
                </Card>
              )}
              {canEditTeam && showAddMember && (
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Add Member</h3>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Members are added automatically when they join with the project PIN. You can also add members manually below.</p>
                  <form onSubmit={(e) => { e.preventDefault(); handleAddMember() }}>
                    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                      <ComboboxInput
                        id="add-member-equipment-id"
                        label="Equipment ID"
                        value={addMemberData.equipmentId}
                        // Suggest existing assignable equipment so admins
                        // can pick a starting slot like "PNL1" or "WLBP3"
                        // and watch the preview below light up.
                        options={equipment.filter((e) => isAssignable(e.category)).map((e) => e.name).sort(naturalCompare)}
                        placeholder="e.g. PNL1"
                        onChange={(v) => setAddMemberData({ ...addMemberData, equipmentId: v })}
                      />
                      <ComboboxInput
                        id="add-member-first-name"
                        label="First Name"
                        value={addMemberData.firstName}
                        options={firstNameSuggestions}
                        onChange={(v) => setAddMemberData({ ...addMemberData, firstName: v })}
                      />
                      <ComboboxInput
                        label="Last Name"
                        value={addMemberData.lastName}
                        options={lastNameSuggestions}
                        onChange={(v) => setAddMemberData({ ...addMemberData, lastName: v })}
                      />
                      <ComboboxInput
                        label="Department"
                        value={addMemberData.department}
                        options={departmentSuggestions}
                        placeholder=""
                        onChange={(v) => setAddMemberData({ ...addMemberData, department: v })}
                      />
                      <ComboboxInput
                        label="Position"
                        value={addMemberData.position}
                        options={positionSuggestions}
                        placeholder=""
                        onChange={(v) => setAddMemberData({ ...addMemberData, position: v })}
                      />
                      <FormInput
                        label="Quantity"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={addMemberData.quantity}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, '')
                          setAddMemberData({ ...addMemberData, quantity: v })
                        }}
                      />
                      <SearchableSelect
                        label="Role"
                        value={addMemberData.role}
                        placeholder="Select..."
                        options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
                        onChange={(v) => setAddMemberData({ ...addMemberData, role: v })}
                      />
                    </div>

                    {/* ─── Live slot preview ───
                        When Equipment ID is set we generate the target
                        slot names by incrementing the trailing number,
                        cross-reference each one against the project's
                        equipment, and tag it as empty / replacing /
                        missing / invalid. The Add button is disabled
                        when ANY slot is missing or non-assignable so
                        the user can't submit a partial range. */}
                    {(() => {
                      const idRaw = addMemberData.equipmentId.trim()
                      if (!idRaw) return null
                      const m = idRaw.match(/^(.*?)(\d+)$/)
                      if (!m) {
                        return (
                          <p className="mt-3 text-xs text-red-400">
                            Equipment ID must end with a number (e.g. PNL1, WLBP3).
                          </p>
                        )
                      }
                      const prefix = m[1]
                      const startN = parseInt(m[2], 10)
                      const digitWidth = m[2].length
                      const qty = Math.max(1, Math.min(200, parseInt(addMemberData.quantity, 10) || 1))
                      const slots = Array.from({ length: qty }, (_, i) => {
                        const name = `${prefix}${String(startN + i).padStart(digitWidth, '0')}`
                        const eq = equipment.find((e) => e.name === name)
                        if (!eq) return { name, status: 'missing' as const }
                        if (!isAssignable(eq.category)) return { name, status: 'invalid' as const }
                        if (eq.assignedToId) return { name, status: 'replacing' as const, current: eq.assignedToName ?? '' }
                        return { name, status: 'empty' as const }
                      })
                      return (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                          {slots.map((s) => {
                            const cls =
                              s.status === 'empty'
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                : s.status === 'replacing'
                                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                                  : 'border-red-500/40 bg-red-500/10 text-red-300'
                            return (
                              <span
                                key={s.name}
                                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono ${cls}`}
                                title={
                                  s.status === 'empty' ? 'Empty — will be filled' :
                                  s.status === 'replacing' ? `Replacing ${s.current}` :
                                  s.status === 'invalid' ? 'Not an assignable category' :
                                  "Doesn't exist in this project"
                                }
                              >
                                {s.name}
                                {s.status === 'empty' && <span className="text-[10px]">✓</span>}
                                {s.status === 'replacing' && (
                                  <span className="text-[10px] font-sans not-italic">→ {s.current}</span>
                                )}
                                {s.status === 'missing' && <span className="text-[10px]">missing</span>}
                                {s.status === 'invalid' && <span className="text-[10px]">invalid</span>}
                              </span>
                            )
                          })}
                        </div>
                      )
                    })()}
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
                        disabled={!addMemberData.firstName.trim() || !addMemberData.lastName.trim()}
                        onClick={() => {
                          const firstName = addMemberData.firstName.trim()
                          const lastName = addMemberData.lastName.trim()
                          const name = `${firstName} ${lastName}`
                          // Include first + last in the URL so the join
                          // page pre-fills the invitee's name. Matches
                          // the kiosk's buildJoinUrl helper.
                          const params = new URLSearchParams({
                            pin: project.pin,
                            firstName,
                            lastName,
                          })
                          const joinUrl = `https://versacom-app.vercel.app/login/join?${params.toString()}`
                          const text = `Hi ${name}, you've been accepted into ${project.name}! Scan or tap: ${joinUrl}`
                          navigator.clipboard.writeText(text).then(() => showToast('success', 'Invite message copied to clipboard'))
                        }}
                      >
                        Invite
                      </Button>
                      <button
                        type="button"
                        onClick={() => setShowAddMember(false)}
                        disabled={isPending}
                        className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                      >
                        Cancel
                      </button>
                      <Button type="submit" className="w-full sm:w-auto" disabled={isPending || !addMemberData.firstName.trim() || !addMemberData.lastName.trim() || addEquipmentBlocked}>{isPending ? 'Adding...' : 'Add'}</Button>
                    </div>
                  </form>
                </Card>
              )}
              {filteredMembers.length === 0 ? (
                <EmptyState icon={<UsersIcon />} title={teamSearch ? 'No matches found' : 'No team members yet'} message={teamSearch ? 'Try a different search term.' : 'Members join via the project PIN.'} />
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {filteredMembers.map((m) => {
                    const isEditing = editingMemberId === m.id
                    return (
                      <div key={m.id} className={`py-3 transition-colors ${isEditing ? '' : 'hover:bg-white/[0.04]'}`}>
                        {isEditing ? (
                          <form
                            data-edit-form="team"
                            data-card-id={m.id}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                setEditingMemberId(null)
                                setChainTarget(null)
                              }
                            }}
                            onSubmit={(e) => { e.preventDefault(); handleSaveMember(m) }}>
                            <div className="text-sm font-semibold text-white">
                              {m.firstName} {m.lastName}
                              {m.position && <span className="text-gray-500"> · {m.position}</span>}
                              <span className="text-gray-500"> · {ROLE_LABELS[m.role] || m.role}</span>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <ComboboxInput
                                compact
                                label="First Name"
                                value={editMemberData.firstName}
                                options={firstNameSuggestions}
                                onChange={(v) => setEditMemberData({ ...editMemberData, firstName: v })}
                              />
                              <ComboboxInput
                                compact
                                label="Last Name"
                                value={editMemberData.lastName}
                                options={lastNameSuggestions}
                                onChange={(v) => setEditMemberData({ ...editMemberData, lastName: v })}
                              />
                              <ComboboxInput
                                compact
                                label="Department"
                                value={editMemberData.department}
                                options={departmentSuggestions}
                                onChange={(v) => setEditMemberData({ ...editMemberData, department: v })}
                              />
                              <ComboboxInput
                                compact
                                label="Position"
                                value={editMemberData.position}
                                options={positionSuggestions}
                                onChange={(v) => setEditMemberData({ ...editMemberData, position: v })}
                              />
                              <SearchableSelect
                                compact
                                label="Role"
                                value={editMemberData.role}
                                placeholder="Select..."
                                options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
                                onChange={(v) => setEditMemberData({ ...editMemberData, role: v })}
                              />
                            </div>
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                              <button type="button" onClick={() => handleDeleteMember(m)} disabled={isPending} className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Delete</button>
                              <button type="button" onClick={() => setEditingMemberId(null)} disabled={isPending} className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Cancel</button>
                              <Button type="submit" size="sm" disabled={isPending} className="w-full sm:w-auto">Save</Button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                            <div>
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-semibold text-white">
                                <span>{m.firstName} {m.lastName}</span>
                                {m.department && <span className="text-gray-400">· {m.department}</span>}
                                {m.position && <span className="text-gray-400">· {m.position}</span>}
                                <span className="text-gray-400">· {ROLE_LABELS[m.role] || m.role}</span>
                                <span className={m.hasPin ? 'text-green-400' : 'italic text-gray-500'}>
                                  · {m.hasPin ? 'Active' : 'Pending'}
                                </span>
                              </div>
                              {m.equipmentNames.length > 0 ? (
                                <div className="mt-1.5 flex items-center justify-between gap-3 text-xs font-medium">
                                  {/* Equipment names are clickable when
                                      the user can edit equipment — tapping
                                      one jumps to the Equipment tab and
                                      opens that gear's edit form inline.
                                      Falls back to plain cyan text when
                                      the user is read-only. */}
                                  <span className="flex flex-wrap items-baseline gap-x-1 truncate">
                                    {m.equipmentNames.map((name, i) => {
                                      const item = equipment.find((e) => e.name === name)
                                      return (
                                        <span key={name}>
                                          {i > 0 && <span className="text-gray-500">, </span>}
                                          {item && canEditEquipment ? (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                // Clear filters so the
                                                // target row is guaranteed
                                                // visible after we switch
                                                // tabs, then open its
                                                // inline edit form.
                                                setEqSearch('')
                                                setEqLocationFilter(null)
                                                changeTab('equipment')
                                                startEqEdit(item)
                                              }}
                                              className="text-[#22a7d3] hover:text-[#019bc7] hover:underline"
                                            >
                                              {name}
                                            </button>
                                          ) : (
                                            <span className="text-[#22a7d3]">{name}</span>
                                          )}
                                          {/* Hardware type suffix in
                                              gray so the admin can tell
                                              at a glance what KIND of
                                              gear this row points at
                                              (e.g. "PNL 1 RSP-1232").
                                              Lives outside the click
                                              target — informational
                                              only. */}
                                          {item?.hardwareType && (
                                            <span className="text-gray-500"> {item.hardwareType}</span>
                                          )}
                                        </span>
                                      )
                                    })}
                                  </span>
                                  {m.expansionCount > 0 && (
                                    <span className="shrink-0">
                                      <span className="text-gray-500">Exp: </span>
                                      <span className="text-[#22a7d3]">{m.expansionCount}</span>
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="mt-1.5 text-xs italic text-gray-500">No equipment assigned</div>
                              )}
                            </div>
                            {canEditTeam && <button type="button" data-edit-button={`team-${m.id}`} onClick={() => startMemberEdit(m)} className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white sm:w-auto">Edit</button>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════ PICK LIST TAB ═══════════════════════════════ */}
          {activeTab === 'picklist' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Mobile-only sticky bundle — wrapped in AutoHideHeader
                  so it collapses on scroll-down with the page header. */}
              <AutoHideHeader className="-mx-4 bg-[#202020] sm:-mx-6 lg:-mx-8">
              <div className="px-4 pt-3 sm:px-6 lg:px-8">
                {/* Search + Add moved into the tab dropdown row above
                    on mobile. */}
                {/* Mobile-only divider line below the search row. */}
{/* removed — page-header bottomBorder serves as the toolbar / content divider now */}

                {/* Filter chips: All / function types · A–Z sort toggle.
                    Function-type filter chips on the left, then a cyan dot
                    divider, then the A–Z toggle (same chip styling) on the
                    right. Mirrors the equipment tab's category-then-location
                    pattern. */}
                <div className="pb-3 sm:flex sm:items-center sm:gap-3">
                  {/* Type dropdown + A-Z toggle, far-left within the
                      flex row. sm:flex-1 keeps desktop search/Add
                      anchored on the right. */}
                  <div className="flex items-center gap-2 sm:flex-1">
                    {/* Dropdown takes half the row on mobile; A-Z
                        toggle keeps its compact chip size. Desktop
                        reverts to the fixed chip width. */}
                    <FilterDropdown
                      ariaLabel="Filter by function type"
                      widthClass="w-1/2 sm:w-36 sm:shrink-0"
                      value={plTypeFilter ?? ''}
                      onChange={(v) => setPlTypeFilter(v || null)}
                      options={[
                        { value: '', label: 'All types' },
                        ...FUNCTION_TYPES.map((t) => ({
                          value: t,
                          label: FUNCTION_TYPE_LABELS[t] || t,
                        })),
                      ]}
                    />
                    <Chip active={plSortAbc} onClick={() => setPlSortAbc(!plSortAbc)}>
                      A–Z
                    </Chip>
                  </div>
                  {/* Desktop tab dropdown + collapsible search + Add
                      function. Search icon ↔ input toggle same pattern. */}
                  <div className="hidden items-center gap-2 sm:flex">
                    {!searchOpen && desktopTabDropdown}
                    {searchOpen ? (
                      <>
                        <input
                          type="text"
                          autoFocus
                          placeholder="Search functions..."
                          value={plSearch}
                          onChange={(e) => setPlSearch(e.target.value)}
                          className="w-[280px] rounded-lg border-2 border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
                        />
                        <button
                          type="button"
                          onClick={() => { setSearchOpen(false); setPlSearch('') }}
                          aria-label="Close search"
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
                        >
                          <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </>
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
                    {/* + Add moved into the page header. */}
                  </div>
                </div>
              </div>{/* /sticky bundle */}

              {/* Count text — pinned above the scroll on desktop. */}
              <div className="px-4 sm:px-6 lg:px-8">
              <p className="text-xs flex-shrink-0 pt-1 pb-2 text-gray-500">
                {filteredPickList.length} of {pickListItems.filter((p) => p.type !== 'PTP').length} functions
                {plSearch && ` matching "${plSearch}"`}
              </p>
              </div>
              </AutoHideHeader>

              {/* Scrollable list region (desktop). Add Function card lives
                  INSIDE so it scrolls with the function list. */}
              <div data-scroll-container className="space-y-3 flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto overscroll-none pt-2 pb-4 sm:pb-20">
              {canEditPickList && showAddPl && (
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Add Function</h3>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Add a function. Leave Name blank to bulk-create placeholders (<span className="font-mono">C1</span>, <span className="font-mono">C2</span>…) you can rename later.</p>
                  <form onSubmit={(e) => { e.preventDefault(); handleAddPl() }}>
                    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <FormInput label="ID" type="text" placeholder="Auto" value={addPlData.code} onChange={(e) => setAddPlData({ ...addPlData, code: e.target.value })} />
                      <FormInput autoFocus label="Name" type="text" value={addPlData.name} onChange={(e) => setAddPlData({ ...addPlData, name: e.target.value })} />
                      <SearchableSelect
                        label="Type"
                        value={addPlData.type}
                        placeholder="Select..."
                        options={FUNCTION_TYPES.map((t) => ({ value: t, label: FUNCTION_TYPE_LABELS[t] }))}
                        onChange={(v) => setAddPlData({ ...addPlData, type: v })}
                      />
                      <FormInput
                        label="Quantity"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={addPlData.name.trim() ? '1' : addPlData.quantity}
                        disabled={!!addPlData.name.trim()}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '')
                          setAddPlData({ ...addPlData, quantity: val })
                        }}
                      />
                    </div>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                      <button type="button" onClick={() => setShowAddPl(false)} disabled={isPending} className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Cancel</button>
                      {(() => {
                        const hasName = !!addPlData.name.trim()
                        const qty = parseInt(addPlData.quantity, 10)
                        const ok = hasName || (Number.isFinite(qty) && qty > 0)
                        return <Button type="submit" disabled={isPending || !ok} className="w-full sm:w-auto">{isPending ? 'Adding...' : 'Add'}</Button>
                      })()}
                    </div>
                  </form>
                </Card>
              )}
              {filteredPickList.length === 0 ? (
                <EmptyState icon={<ListIcon />} title={plSearch ? 'No matches found' : 'No functions yet'} message={plSearch ? 'Try a different search term.' : 'Add communication functions using the button above.'} />
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {filteredPickList.map((item) => {
                    const isEditing = editingPlId === item.id
                    return (
                      <div key={item.id} className={`py-3 transition-colors ${isEditing ? '' : 'hover:bg-white/[0.04]'}`}>
                        {isEditing ? (
                          <form
                            data-edit-form="picklist"
                            data-card-id={item.id}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                setEditingPlId(null)
                                setChainTarget(null)
                              }
                            }}
                            onSubmit={(e) => { e.preventDefault(); handleSavePl(item) }}>
                            <div className="flex items-center gap-2">
                              {item.code && <span className="text-sm font-semibold text-white">{item.code}</span>}
                              <span className="text-sm font-semibold text-white">{item.name}</span>
                              <span className="inline-flex items-center rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200">{FUNCTION_TYPE_LABELS[item.type] || item.type}</span>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <FormInput compact label="ID" type="text" value={editPlData.code} onChange={(e) => setEditPlData({ ...editPlData, code: e.target.value })} />
                              <FormInput compact label="Name" type="text" value={editPlData.name} onChange={(e) => setEditPlData({ ...editPlData, name: e.target.value })} />
                              <SearchableSelect
                                compact
                                label="Type"
                                value={editPlData.type}
                                placeholder="Select..."
                                options={FUNCTION_TYPES.map((t) => ({ value: t, label: FUNCTION_TYPE_LABELS[t] }))}
                                onChange={(v) => setEditPlData({ ...editPlData, type: v })}
                              />
                            </div>
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                              <button type="button" onClick={() => handleDeletePl(item)} disabled={isPending} className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Delete</button>
                              <button type="button" onClick={() => setEditingPlId(null)} disabled={isPending} className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Cancel</button>
                              <Button type="submit" size="sm" disabled={isPending} className="w-full sm:w-auto">Save</Button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                {item.code && <span className="text-sm font-semibold text-white">{item.code}</span>}
                                <span className="text-sm font-semibold text-white">{item.name}</span>
                                <span className="inline-flex items-center rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200">{FUNCTION_TYPE_LABELS[item.type] || item.type}</span>
                              </div>
                              {item.users.length > 0 ? (
                                <PickListUsers users={item.users} />
                              ) : (
                                <div className="mt-1.5 text-xs italic text-gray-500">Unused</div>
                              )}
                            </div>
                            {canEditPickList && <button type="button" data-edit-button={`picklist-${item.id}`} onClick={() => startPlEdit(item)} className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white sm:w-auto">Edit</button>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════ STAGE PLOTS TAB ═══════════════════════════════ */}
          {activeTab === 'stage-plots' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Plots tab has no filter chips — desktop still gets
                  a tab dropdown + collapsible search + Add row
                  aligned to the right so the toolbar pattern is
                  consistent across tabs. */}
              <div className="hidden items-center justify-end gap-2 pb-3 sm:flex">
                {!searchOpen && desktopTabDropdown}
                {searchOpen ? (
                  <>
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search plots..."
                      value={plotSearch}
                      onChange={(e) => setPlotSearch(e.target.value)}
                      className="w-[280px] rounded-lg border-2 border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
                    />
                    <button
                      type="button"
                      onClick={() => { setSearchOpen(false); setPlotSearch('') }}
                      aria-label="Close search"
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
                    >
                      <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </>
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
                {/* + Add moved into the page header. */}
              </div>

              {/* Count text — pinned above the scroll on desktop. */}
              <p className="text-xs flex-shrink-0 pt-1 pb-2 text-gray-500">
                {filteredPlots.length} of {plots.length} {plots.length === 1 ? 'plot' : 'plots'}
                {plotSearch && ` matching "${plotSearch}"`}
              </p>

              {/* Scrollable list region (desktop). Add Plot card lives
                  INSIDE so it scrolls with the plot list. */}
              <div data-scroll-container className="space-y-3 flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto overscroll-none pt-2 pb-4 sm:pb-20">

              {isAdmin && showAddPlot && (
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Add Stage Plot</h3>
                  </div>
                  <div className="mt-4 flex flex-col gap-3">
                    <ComboboxInput
                      label="Label"
                      value={addPlotLabel}
                      options={['FOH', 'Stage Left', 'Stage Right', 'Monitors', 'Venue Blueprint', 'Drum Riser', 'Patch List', ...allLocations]}
                      onChange={setAddPlotLabel}
                    />
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-gray-400">PDF Link</label>
                      <input
                        type="url"
                        value={addPlotUrl}
                        onChange={(e) => setAddPlotUrl(e.target.value)}
                        placeholder="https://drive.google.com/file/d/..."
                        className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <p className="mt-1.5 text-[11px] text-gray-500">
                        Paste a Google Drive (or other) link to the PDF. Sharing must be set to{' '}
                        <span className="font-medium text-gray-300">Anyone with the link</span> so crew can open it.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                    <button type="button" onClick={() => { setShowAddPlot(false); setAddPlotLabel(''); setAddPlotUrl('') }} disabled={isPending} className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Cancel</button>
                    <Button
                      type="button"
                      disabled={!addPlotLabel.trim() || !addPlotUrl.trim() || isPending}
                      className="w-full sm:w-auto"
                      onClick={() => {
                        startTransition(async () => {
                          const result = await createPlot(project.id, {
                            label: addPlotLabel.trim(),
                            url: addPlotUrl.trim(),
                          })
                          if (result.error) { showToast('error', result.error); return }
                          setAddPlotLabel('')
                          setAddPlotUrl('')
                          setShowAddPlot(false)
                          router.refresh()
                        })
                      }}
                    >
                      {isPending ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </Card>
              )}
              {filteredPlots.length === 0 ? (
                <EmptyState
                  icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>}
                  title={plotSearch ? 'No matches found' : 'No stage plots yet'}
                  message={plotSearch ? 'Try a different search term.' : isAdmin ? 'Add a PDF link to share venue layouts with your crew.' : 'No stage plots have been added yet.'}
                />
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {filteredPlots.map((plot) => {
                    const isEditingPlot = editingPlotId === plot.id
                    return (
                      <div key={plot.id} className={`py-3 transition-colors ${isEditingPlot ? '' : 'hover:bg-white/[0.04]'}`}>
                        {isEditingPlot ? (
                          <>
                            <div className="flex flex-col gap-3">
                              <ComboboxInput
                                label="Label"
                                value={editPlotData.label}
                                options={['FOH', 'Stage Left', 'Stage Right', 'Monitors', 'Venue Blueprint', 'Drum Riser', 'Patch List', ...allLocations]}
                                onChange={(v) => setEditPlotData({ ...editPlotData, label: v })}
                              />
                              <div>
                                <label className="mb-1.5 block text-xs font-medium text-gray-400">PDF Link</label>
                                <input
                                  type="url"
                                  value={editPlotData.url}
                                  onChange={(e) => setEditPlotData({ ...editPlotData, url: e.target.value })}
                                  placeholder="https://drive.google.com/file/d/..."
                                  className="w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
                                  autoComplete="off"
                                  spellCheck={false}
                                />
                                <p className="mt-1.5 text-[11px] text-gray-500">
                                  Paste a Google Drive (or other) link to the PDF. Sharing must be set to{' '}
                                  <span className="font-medium text-gray-300">Anyone with the link</span> so crew can open it.
                                </p>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => {
                                  startTransition(async () => {
                                    const result = await deletePlot(project.id, plot.id)
                                    if (result.error) { showToast('error', result.error); return }
                                    setEditingPlotId(null)
                                    router.refresh()
                                  })
                                }}
                                className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                              >
                                Delete
                              </button>
                              <button type="button" onClick={() => setEditingPlotId(null)} disabled={isPending} className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">Cancel</button>
                              <Button
                                size="sm"
                                disabled={!editPlotData.label.trim() || !editPlotData.url.trim() || isPending}
                                className="w-full sm:w-auto"
                                onClick={() => {
                                  startTransition(async () => {
                                    const result = await updatePlot(project.id, plot.id, {
                                      label: editPlotData.label.trim(),
                                      url: editPlotData.url.trim(),
                                    })
                                    if (result.error) { showToast('error', result.error); return }
                                    setEditingPlotId(null)
                                    router.refresh()
                                  })
                                }}
                              >
                                {isPending ? 'Saving…' : 'Save'}
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                            <span className="text-sm font-semibold text-white">{plot.label}</span>
                            <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0 sm:items-center">
                              <a
                                href={plot.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full rounded-lg border border-white/10 px-3 py-1.5 text-center text-xs font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white sm:w-auto sm:text-left"
                              >
                                Open
                              </a>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => { setEditingPlotId(plot.id); setEditPlotData({ label: plot.label, url: plot.url }) }}
                                  className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white sm:w-auto"
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════ RACKS TAB ═══════════════════════════════
              Per-project rack designer. Each RackTemplate row (dept='comms',
              scoped to this project) is rendered as a card with name +
              location + RU count + slot count. Clicking a rack drills into
              the rack designer page (TODO — landing in a follow-up commit).
              The + (Add Rack) button in the page header opens the inline
              Create Rack form. */}
          {activeTab === 'racks' && (() => {
            // Render-side filter — case-insensitive substring match on
            // name or location. Empty query keeps everything.
            const q = rackSearch.trim().toLowerCase()
            const filteredRacks = q.length === 0
              ? commsRacks
              : commsRacks.filter((r) =>
                  r.name.toLowerCase().includes(q) ||
                  (r.location ?? '').toLowerCase().includes(q),
                )
            return (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Desktop toolbar — tab dropdown + collapsible search on
                  the right. Mirrors the Plots / Comms pattern: search
                  icon expands into an input that replaces the dropdown
                  space, X collapses it. (Front/Rear used to live here
                  on the far left when a rack was expanded; moved into
                  the device library's top row alongside + Custom
                  device, so the library is now the canonical home for
                  rack-context controls.) */}
              <div className="hidden items-center justify-end gap-2 pb-3 sm:flex">
                {!searchOpen && desktopTabDropdown}
                {searchOpen ? (
                  <>
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search racks…"
                      value={rackSearch}
                      onChange={(e) => setRackSearch(e.target.value)}
                      className="w-[280px] rounded-lg border-2 border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
                    />
                    <button
                      type="button"
                      onClick={() => { setSearchOpen(false); setRackSearch('') }}
                      aria-label="Close search"
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
                    >
                      <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </>
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

              {/* Mobile toolbar — handled by the SHARED mobile tab/search
                  toolbar above (the same one that drives Equipment /
                  Team / Pick List / Plots). The Racks tab is wired into
                  that block's `activeTab === 'racks'` branches. No
                  per-tab mobile toolbar needed here. */}

              {/* Inline Create-rack form. Opens when the + button in the
                  page header is tapped. Minimal fields for now — name,
                  location, RU height. Server action wires below. */}
              {showAddRack && (isProjectAdmin || isManager) && (
                <CreateRackForm
                  projectId={project.id}
                  onCancel={() => setShowAddRack(false)}
                  onCreated={() => {
                    setShowAddRack(false)
                    router.refresh()
                  }}
                />
              )}

              {/* Rack list. Empty states differ between "no racks at all"
                  and "racks exist but none match the search". */}
              {commsRacks.length === 0 && !showAddRack ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
                  <div className="text-sm text-gray-400">No racks yet on this show.</div>
                  {(isProjectAdmin || isManager) && (
                    <button
                      type="button"
                      onClick={() => setShowAddRack(true)}
                      className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
                    >
                      + Create rack
                    </button>
                  )}
                </div>
              ) : filteredRacks.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center text-sm text-gray-500">
                  No racks match &ldquo;{rackSearch}&rdquo;.
                </div>
              ) : (
                <div data-scroll-container className="flex min-h-0 flex-1 flex-col divide-y divide-white/[0.06] overflow-y-auto overscroll-none">
                  {/* When a rack is expanded for editing, hide every
                      other rack row so the operator has a clean
                      single-rack workspace. Closing the expansion (×
                      / Close on the row header) restores the full
                      list. This matches PanelStudio's focus mode —
                      one thing at a time, no neighboring rows
                      competing for attention or scroll. */}
                  {filteredRacks
                    .filter((r) => expandedRackId == null || r.id === expandedRackId)
                    .map((r) => {
                    const isExpanded = expandedRackId === r.id
                    return (
                    <div
                      key={r.id}
                      // Desktop only: when expanded, the row becomes
                      // a flex-1 column inside the racks-tab scroll
                      // body so the chassis + library fill the
                      // viewport. Mobile (no lg:) keeps natural row
                      // height — the chassis grows to its full
                      // totalRU * 48 height and the page scrolls.
                      className={`flex flex-col ${isExpanded ? 'lg:min-h-0 lg:flex-1' : ''}`}
                    >
                      {/* Header row.
                          - Collapsed: static "name · location · RU ·
                            slots" strip + Edit button (toggles expand).
                          - Expanded: editable Name / Location / RU
                            inputs in place of the static text, plus
                            Save + Delete + Close. Inputs are admin/
                            manager only; read-only viewers see the
                            static text even when expanded. */}
                      {isExpanded && (isProjectAdmin || isManager) ? (
                        <AutoHideHeader>
                        <div className="flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-center">
                          {/* Inputs container.
                              - Mobile: 2-column grid → Name + Location
                                share row 1, RU spans the full second
                                row.
                              - Desktop (>= sm): flex row, Name +
                                Location flex-1 each, RU compact at
                                w-20. */}
                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-1 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-2">
                            <input
                              value={rackEditForm.name}
                              onChange={(e) => setRackEditForm((f) => ({ ...f, name: e.target.value }))}
                              disabled={rackEditSaving}
                              placeholder="Rack name"
                              aria-label="Rack name"
                              className="min-w-0 w-full sm:flex-1 rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm font-semibold text-white placeholder-gray-500 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
                            />
                            <input
                              value={rackEditForm.location}
                              onChange={(e) => setRackEditForm((f) => ({ ...f, location: e.target.value }))}
                              disabled={rackEditSaving}
                              placeholder="Location"
                              aria-label="Rack location"
                              className="min-w-0 w-full sm:flex-1 rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
                            />
                            <input
                              type="number"
                              min={1}
                              max={60}
                              value={rackEditForm.totalRU}
                              onChange={(e) => setRackEditForm((f) => ({ ...f, totalRU: e.target.value }))}
                              disabled={rackEditSaving}
                              aria-label="RU height"
                              placeholder="RU"
                              className="col-span-2 w-full sm:col-span-1 sm:w-20 rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
                            />
                          </div>
                          {/* Action row — Delete · Close · Save (left
                              to right) mirroring the equipment / team
                              / pick-list edit cards. Full-width on
                              mobile, auto on desktop. */}
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                            <button
                              type="button"
                              onClick={() => setRackDeleteConfirm({ id: r.id, name: r.name })}
                              disabled={rackEditSaving}
                              className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedRackId(null)}
                              disabled={rackEditSaving}
                              className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                            >
                              Close
                            </button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={async () => {
                                const name = rackEditForm.name.trim()
                                const totalRU = parseInt(rackEditForm.totalRU, 10)
                                setRackEditError(null)
                                if (!name) { setRackEditError('Name is required'); return }
                                if (!Number.isFinite(totalRU) || totalRU < 1 || totalRU > 60) {
                                  setRackEditError('RU height must be 1–60'); return
                                }
                                setRackEditSaving(true)
                                try {
                                  const res = await fetch(`/api/racks/${r.id}`, {
                                    method: 'PATCH',
                                    headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify({
                                      name,
                                      location: rackEditForm.location.trim() || null,
                                      totalRU,
                                    }),
                                  })
                                  if (!res.ok) {
                                    const data = await res.json().catch(() => null)
                                    setRackEditError((data as { error?: string } | null)?.error ?? 'Failed to save')
                                    setRackEditSaving(false)
                                    return
                                  }
                                  setRackEditSaving(false)
                                  router.refresh()
                                } catch {
                                  setRackEditError('Network error')
                                  setRackEditSaving(false)
                                }
                              }}
                              disabled={rackEditSaving}
                              className="w-full sm:w-auto"
                            >
                              {rackEditSaving ? 'Saving…' : 'Save'}
                            </Button>
                          </div>
                        </div>
                        </AutoHideHeader>
                      ) : (
                        <div className={`flex flex-col items-stretch gap-4 py-3 transition-colors sm:flex-row sm:items-start sm:gap-4 ${isExpanded ? '' : 'hover:bg-white/[0.04]'}`}>
                          <div className="min-w-0 flex-1 flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-white truncate">{r.name}</span>
                            <span className="shrink-0 text-xs text-gray-500">{r.totalRU}RU</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setExpandedRackId(isExpanded ? null : r.id)}
                            className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white sm:w-auto"
                          >
                            {isExpanded ? 'Close' : 'Edit'}
                          </button>
                        </div>
                      )}
                      {/* Errors from rack metadata save/delete now
                          flow through showToast() — no inline banner
                          here anymore. */}
                      {/* Inline rack studio — uncollapses in place when
                          Edit is tapped. Server pre-fetched slots +
                          looseItems on this rack so the expansion is
                          instant; mutations inside still call the
                          existing /api/racks/.../slots endpoints and
                          router.refresh() pulls fresh data back. */}
                      {isExpanded && (
                        <div className="flex flex-col lg:min-h-0 lg:flex-1">
                          <RackStudio
                            embedded
                            project={{ id: project.id, name: project.name }}
                            userProjects={userProjects}
                            rack={{
                              id: r.id,
                              name: r.name,
                              description: r.description,
                              location: r.location,
                              totalRU: r.totalRU,
                              dept: r.dept,
                            }}
                            slots={r.slots}
                            looseItems={r.looseItems}
                            customDevices={commsCustomDevices}
                            canEdit={isProjectAdmin || isManager}
                            side={expandedRackSide}
                            onSideChange={setExpandedRackSide}
                            onDeleted={() => {
                              // Rack vanished — collapse the expansion
                              // (the row will unmount on refresh too,
                              // but clearing state first prevents a
                              // flash of "expanded but empty").
                              setExpandedRackId(null)
                              router.refresh()
                            }}
                          />
                        </div>
                      )}
                    </div>
                    )
                  })}
                </div>
              )}
            </div>
            )
          })()}

          {/* ═══════════════════════════════ MY EQUIPMENT TAB (User role) ═══════════════════════════════ */}
          {activeTab === 'my-equipment' && (() => {
            const myEquipment = equipment.filter((e) => e.assignedMemberId === currentMemberId)
            const isPanelType = (cat: string) => ['panels', 'hardwire_bp', 'wireless_bp'].includes(cat)
            return (
              <div className="flex min-h-0 flex-1 flex-col">
                {/* Count text — pinned above the scroll on desktop. */}
                <p className="text-xs flex-shrink-0 pt-1 pb-2 text-gray-500">
                  {myEquipment.length} item{myEquipment.length !== 1 ? 's' : ''} assigned to you
                </p>

                {/* Scrollable list region (desktop). */}
                <div data-scroll-container className="space-y-3 flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto overscroll-none pt-2 pb-4 sm:pb-20">
                {myEquipment.length === 0 ? (
                  <EmptyState icon={<WrenchIcon />} title="No equipment assigned" message="You don't have any equipment assigned to you yet." />
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {myEquipment.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-start gap-4 py-3 transition-colors ${isPanelType(item.category) ? 'cursor-pointer hover:bg-[#313131]' : ''}`}
                        onClick={isPanelType(item.category) ? () => router.push(`/projects/${project.id}/panel/${item.id}`) : undefined}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <span
                              className={`text-xs font-semibold transition-colors duration-500 ${item.ipAddress && reachable[item.id] ? 'text-green-400' : 'text-gray-400'}`}
                              title={item.ipAddress && reachable[item.id] ? `${item.ipAddress} — reachable` : undefined}
                            >
                              {item.name}
                            </span>
                            {isPanelType(item.category) && (
                              <span className="rounded bg-[#0178a3]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#22a7d3]">Edit Panel</span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-400">
                            {item.location && <><span className="hidden sm:inline text-gray-500">Location: </span><span>{item.location}</span><span className="text-gray-500">·</span></>}
                            {item.hardwareType && <><span className="hidden sm:inline text-gray-500">Hardware: </span><span>{item.hardwareType}</span></>}
                            {item.headsetType && <><span className="text-gray-500">·</span><span className="hidden sm:inline text-gray-500">Headset: </span><span>{item.headsetType}</span></>}
                            {item.ipAddress && <><span className="text-gray-500">·</span><span className="hidden sm:inline text-gray-500">IP: </span><a href={`http://${item.ipAddress}${item.category === 'panels' ? '/remote-control/' : ''}`} target="_blank" rel="noopener noreferrer" className="text-[#22a7d3] hover:text-[#019bc7]" onClick={(e) => e.stopPropagation()}>{item.ipAddress}</a></>}
                          </div>
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-2 rounded-lg border ${STATUS_BORDER_STYLES[item.deployStatus] || STATUS_BORDER_STYLES.na} px-4 py-2 text-sm font-medium text-gray-200`}>
                          <span className="min-w-[4.5rem]">{getStatusLabel(item.deployStatus)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                </div>
              </div>
            )
          })()}
        </div>
      </PageLayout>

      {/* Join-QR modal — opened by the QR icon in the page header on
          every tab. Renders the project's join URL as a QR code so
          crew can scan from the login screen and the PIN pre-fills. */}
      <Modal
        open={showTeamQr}
        title="Join QR"
        onClose={() => setShowTeamQr(false)}
      >
        {(() => {
          const joinUrl = `https://versacom-app.vercel.app/login/join?pin=${project.pin}`
          return (
            <div className="flex flex-col items-center gap-3">
              <p className="text-xs text-gray-500">
                Show this to crew during gear deployment. Scanning pre-fills the project PIN; existing users sign in, new users create their PIN.
              </p>
              <div className="rounded-xl bg-white p-3">
                <QRCodeSVG value={joinUrl} size={220} level="M" />
              </div>
              <span className="break-all text-center font-mono text-[11px] text-gray-400">{joinUrl}</span>
            </div>
          )
        })()}
      </Modal>

      <Modal
        open={showDeleteConfirm}
        title="Delete Project"
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isPending}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteProject}
              disabled={isPending}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? 'Deleting...' : 'Delete'}
            </button>
          </>
        }
      >
        Are you sure you want to delete <span className="text-white font-medium">{project.name}</span>? This will remove all members and cannot be undone.
      </Modal>

      {/* Delete Rack confirm — replaces window.confirm so the prompt
          matches the project-delete + other in-app modals. The actual
          DELETE fetch runs from the Delete button's onClick below;
          this Modal just gates it on operator confirmation. */}
      <Modal
        open={!!rackDeleteConfirm}
        title="Delete Rack"
        onClose={rackEditSaving ? undefined : () => setRackDeleteConfirm(null)}
        actions={
          <>
            <button
              type="button"
              onClick={() => setRackDeleteConfirm(null)}
              disabled={rackEditSaving}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!rackDeleteConfirm) return
                const id = rackDeleteConfirm.id
                setRackEditError(null)
                setRackEditSaving(true)
                try {
                  const res = await fetch(`/api/racks/${id}`, { method: 'DELETE' })
                  if (!res.ok) {
                    const data = await res.json().catch(() => null)
                    setRackEditError((data as { error?: string } | null)?.error ?? 'Failed to delete')
                    setRackEditSaving(false)
                    return
                  }
                  setRackEditSaving(false)
                  setRackDeleteConfirm(null)
                  setExpandedRackId(null)
                  router.refresh()
                } catch {
                  setRackEditError('Network error')
                  setRackEditSaving(false)
                }
              }}
              disabled={rackEditSaving}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rackEditSaving ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        Delete rack <span className="text-white font-medium">{rackDeleteConfirm?.name}</span>? Every slot and loose item attached to it goes with it. This can&apos;t be undone.
      </Modal>
    </>
  )
}

/**
 * Inline form on the Racks tab — opens when the per-tab + (Add) button
 * is tapped. Fields: name, location (optional), total RU. POSTs to the
 * /api/racks endpoint to create a `RackTemplate` row scoped to this
 * project + dept='comms'.
 */
function CreateRackForm({
  projectId,
  onCancel,
  onCreated,
}: {
  projectId: number
  onCancel: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [totalRU, setTotalRU] = useState('17')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) { setError('Name is required'); return }
    const ruNum = parseInt(totalRU, 10)
    if (!Number.isFinite(ruNum) || ruNum < 1) { setError('RU height must be a positive integer'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/racks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: trimmedName,
          location: location.trim() || null,
          totalRU: ruNum,
          dept: 'comms',
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError((data as { error?: string } | null)?.error ?? 'Failed to create rack')
        setSaving(false)
        return
      }
      onCreated()
    } catch {
      setError('Network error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-3 rounded-lg border border-white/10 bg-[#1a1a1a] p-4">
      <div className="text-sm font-semibold text-white mb-3">Create rack</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_120px]">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Name</div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="FOH Rack"
            className="w-full rounded-lg border border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
          />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Location <span className="normal-case text-gray-600">(optional)</span></div>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="FOH, MON, STAGE…"
            className="w-full rounded-lg border border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
          />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">RU height</div>
          <input
            type="number"
            min={1}
            max={50}
            value={totalRU}
            onChange={(e) => setTotalRU(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
          />
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  )
}
