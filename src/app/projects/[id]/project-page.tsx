'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PencilIcon, XMarkIcon, ChevronLeftIcon } from '@heroicons/react/24/outline'
import { QRCodeSVG } from 'qrcode.react'
import { STATUS_BADGE_STYLES, getStatusLabel } from '@/lib/deploy-status'
import { DeployStatusSelect } from '@/components/deploy-status-select'
import { useDeviceReachability } from '@/hooks/use-device-reachability'
import { Button } from '@/components/button'
import { showToast } from '@/components/toast'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'
import { Card } from '@/components/card'
import { EmptyState } from '@/components/empty-state'
import { IconButton } from '@/components/icon-button'
import { Modal } from '@/components/modal'
import { FormInput, FormSelect } from '@/components/form-field'
import { SearchableSelect } from '@/components/searchable-select'
import { ComboboxInput } from '@/components/combobox-input'
import { FilterBar, Chip } from '@/components/filter-bar'
import { LocationSummary } from '@/components/location-summary'
import { usePersistentState } from '@/lib/use-persistent-state'
import { updateProject, deleteProject } from './actions'
import { bulkCreateEquipment, updateEquipment, deleteEquipment } from './distribution/actions'
import { createMember, updateMember, deleteMember } from './team-actions'
import { createPickListItem, updatePickListItem, deletePickListItem } from './picklist-actions'

/* ─── Constants ─── */

const CATEGORIES = [
  { value: 'panels', label: 'Panels', prefix: 'PNL', assignable: true },
  { value: 'wireless_bp', label: 'Wireless BP', prefix: 'WLBP', assignable: true },
  { value: 'hardwire_bp', label: 'Hardwire BP', prefix: 'HWBP', assignable: true },
  { value: 'switches', label: 'Switches', prefix: 'SW', assignable: false },
  { value: 'antennas', label: 'Antennas', prefix: 'ANT', assignable: false },
  { value: 'audio', label: 'Audio', prefix: 'AUD', assignable: false },
] as const

const HARDWARE_TYPES: Record<string, string[]> = {
  panels: ['RSP-1232', 'RSP-1216', 'DSP-1216', 'KP-5032', 'KP32', 'RSP-2318', 'DSP-2312', 'DKP-3016', 'KP-3016', 'DSPK4'],
  wireless_bp: ['Bolero 1.9', 'Bolero 2.4', 'Freespeak', 'Pliant'],
  hardwire_bp: ['Helixnet', 'DBP4', 'DBP5', 'ST-374', 'ST370', 'C3', 'BP325'],
  switches: ['26P+4F', '40P+4F', '16F', '9P+1F', 'Intellanet Old', 'Intellanet New', 'Media', 'Antaira', 'TP Link'],
  antennas: ['Bolero 1.9', 'Bolero 2.4', 'Pliant', 'Freespeak 1.9', 'Freespeak 2.4'],
  audio: ['NA2', 'A16r', 'Dark88'],
}

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

type Tab = 'equipment' | 'team' | 'picklist' | 'my-equipment' | 'stage-plots'

type Member = {
  id: number
  role: string
  position: string | null
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
  assignedMemberId: number | null
  gooseneck: boolean
  footswitches: number
  speakers: number
}

type AssignableMember = { id: number; name: string }

type PickListItemType = { id: number; code: string | null; name: string; type: string; users: string[] }

/* ─── Helpers ─── */

function isAssignable(category: string) {
  return ['panels', 'wireless_bp', 'hardwire_bp'].includes(category)
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

function hasField(category: string, field: string) {
  const panelFields = ['location', 'headsetType', 'ipAddress']
  const wirelessFields = ['headsetType']
  const hardwireFields = ['location', 'headsetType', 'ipAddress']
  const switchFields = ['location', 'ipAddress', 'patch']
  const antennaFields = ['location', 'ipAddress']
  const audioFields = ['location']
  if (category === 'panels') return panelFields.includes(field)
  if (category === 'wireless_bp') return wirelessFields.includes(field)
  if (category === 'hardwire_bp') return hardwireFields.includes(field)
  if (category === 'switches') return switchFields.includes(field)
  if (category === 'antennas') return antennaFields.includes(field)
  if (category === 'audio') return audioFields.includes(field)
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

function ListIcon() {
  return (
    <svg className="mx-auto size-12 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
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
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Remember this project so the "Projects" nav link comes back here
  useEffect(() => {
    document.cookie = `lastProject=${project.id};path=/;max-age=${60 * 60 * 24 * 365}`
  }, [project.id])

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

  // Tab state — user role only sees "My Equipment"
  const [activeTab, setActiveTab] = useState<Tab>(isUser ? 'my-equipment' : 'equipment')

  // Settings panel
  const [showSettings, setShowSettings] = useState(false)
  const [name, setName] = useState(project.name)
  const [status, setStatus] = useState(project.status)
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
  const [addEquipmentId, setAddEquipmentId] = useState('')
  const [addCategory, setAddCategory] = useState('panels')
  const [addHardwareType, setAddHardwareType] = useState('')
  const [addQuantity, setAddQuantity] = useState('1')
  const [addError, setAddError] = useState('')
  const [editingEqId, setEditingEqId] = useState<number | null>(null)
  const [editEqData, setEditEqData] = useState<Partial<EquipmentItem>>({})

  // Team state
  const [teamSearch, setTeamSearch] = useState('')
  const [teamCategoryFilter, setTeamCategoryFilter] = usePersistentState<string | null>(
    `proj-${project.id}-teamCategory`,
    null,
  )
  const [showAddMember, setShowAddMember] = useState(false)
  const [showJoinQr, setShowJoinQr] = useState(false)
  // Crew users don't get the Add Member form but DO get a standalone QR
  // card they can pull up to show to end users during gear deployment.
  const [showTeamQr, setShowTeamQr] = useState(false)
  const [addMemberData, setAddMemberData] = useState<{ firstName: string; lastName: string; position: string; role: string }>({ firstName: '', lastName: '', position: '', role: 'user' })
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null)
  const [editMemberData, setEditMemberData] = useState<{ firstName: string; lastName: string; position: string; role: string }>({ firstName: '', lastName: '', position: '', role: 'crew' })

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
  const [showAddPlot, setShowAddPlot] = useState(false)
  const [addPlotLabel, setAddPlotLabel] = useState('')
  const [addPlotUrl, setAddPlotUrl] = useState('')
  const [editingPlotId, setEditingPlotId] = useState<number | null>(null)
  const [editPlotData, setEditPlotData] = useState<{ label: string; url: string }>({ label: '', url: '' })
  const [plotUploading, setPlotUploading] = useState(false)
  const [plotUploadError, setPlotUploadError] = useState('')
  const [mockPlots, setMockPlots] = useState([
    { id: 1, label: 'FOH', url: 'https://example.com/foh.pdf' },
    { id: 2, label: 'Stage Left', url: 'https://example.com/sl.pdf' },
    { id: 3, label: 'Venue Blueprint', url: 'https://example.com/venue.pdf' },
  ])

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

  function handleBulkAdd() {
    const qty = parseInt(addQuantity, 10)
    if (!qty || qty < 1) { setAddError('Quantity must be at least 1'); return }
    if (qty > 200) { setAddError('Quantity must be at most 200'); return }
    setAddError('')
    startTransition(async () => {
      const result = await bulkCreateEquipment(project.id, addCategory, addHardwareType, qty, addEquipmentId)
      if (result.error) { setAddError(result.error); return }
      showToast('success', `Added ${result.count} ${getCategoryLabel(addCategory)}`)
      setShowAdd(false)
      setAddEquipmentId('')
      setAddHardwareType('')
      setAddQuantity('1')
      router.refresh()
    })
  }

  function startEqEdit(item: EquipmentItem) {
    setEditingEqId(item.id)
    setEditEqData({
      name: item.name,
      hardwareType: item.hardwareType || '',
      location: item.location || '',
      headsetType: item.headsetType || '',
      ipAddress: item.ipAddress || '',
      patch: item.patch || '',
      deployStatus: item.deployStatus,
      assignedToId: item.assignedMemberId,
      gooseneck: item.gooseneck ?? false,
      footswitches: item.footswitches ?? 0,
      speakers: item.speakers ?? 0,
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
        position: null,
        location: normalizedLocation,
        headsetType: hasField(item.category, 'headsetType') ? (editEqData.headsetType as string) || null : null,
        ipAddress: hasField(item.category, 'ipAddress') ? (editEqData.ipAddress as string) || null : null,
        patch: hasField(item.category, 'patch') ? (editEqData.patch as string) || null : null,
        deployStatus: (editEqData.deployStatus as string) || 'na',
        assignedToId: isAssignable(item.category) ? (editEqData.assignedToId as number | null) : null,
        // Panel-only misc accessories
        gooseneck: item.category === 'panels' ? Boolean(editEqData.gooseneck) : false,
        footswitches: item.category === 'panels' ? Number(editEqData.footswitches ?? 0) : 0,
        speakers: item.category === 'panels' ? Number(editEqData.speakers ?? 0) : 0,
      })
      if (result.error) { showToast('error', result.error); return }
      setEditingEqId(null)
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
    setEditMemberData({ firstName: m.firstName, lastName: m.lastName, position: m.position || '', role: m.role })
  }

  function handleSaveMember(m: Member) {
    startTransition(async () => {
      const result = await updateMember(project.id, m.id, editMemberData)
      if (result.error) { showToast('error', result.error); return }
      setEditingMemberId(null)
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
    startTransition(async () => {
      const result = await createMember(project.id, addMemberData)
      if (result.error) { showToast('error', result.error); return }
      showToast('success', `${addMemberData.firstName.trim()} ${addMemberData.lastName.trim()} added`)
      setShowAddMember(false)
      setAddMemberData({ firstName: '', lastName: '', position: '', role: 'user' })
      router.refresh()
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
      setEditingPlId(null)
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

  const filteredEquipment = equipment.filter((e) => {
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

  // Equipment categories the project actually uses (so chips don't include
  // empty buckets the user has no gear in).
  const usedEquipmentCategories = CATEGORIES.filter((c) =>
    equipment.some((e) => e.category === c.value),
  )

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
      // When the search matches equipment names (PNL, WLBP, HWBP, etc.),
      // sort by the equipment number rather than alphabetically by member —
      // so results read PNL 1, PNL 2, PNL 3 … PNL 10 instead of being
      // jumbled by whatever the assignee's first name is. Members whose
      // equipment doesn't match the query (e.g. they only matched by name)
      // fall back to alphabetical ordering after the equipment matches.
      const q = teamSearch.trim().toLowerCase()
      if (q) {
        const numA = lowestMatchingEquipmentNum(a.equipmentNames, q)
        const numB = lowestMatchingEquipmentNum(b.equipmentNames, q)
        if (numA != null && numB != null && numA !== numB) return numA - numB
        if (numA != null && numB == null) return -1
        if (numA == null && numB != null) return 1
      }
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
    .sort((a, b) => plSortAbc ? naturalCompare(a.name, b.name) : 0)

  const filteredPlots = mockPlots.filter((p) =>
    !plotSearch || p.label.toLowerCase().includes(plotSearch.toLowerCase())
  )

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

  return (
    <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} showMyEquipment={isCrew}>
      <PageLayout
        title={project.name}
        titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
        inlineAction
        before={
          <button
            type="button"
            onClick={() => router.push('/projects')}
            className="inline-flex items-center gap-1 text-sm text-gray-400 transition-colors hover:text-white"
          >
            <ChevronLeftIcon className="size-4" />
            <span>Projects</span>
          </button>
        }
        action={
          canSeeSettings && (
            <Button
              variant="secondary"
              onClick={() => setShowSettings(!showSettings)}
              aria-label={showSettings ? 'Close settings' : 'Edit project'}
            >
              <span className="sm:hidden inline-flex items-center">
                {showSettings ? <XMarkIcon className="size-5" /> : <PencilIcon className="size-5" />}
              </span>
              <span className="hidden sm:inline">{showSettings ? 'Close' : 'Edit'}</span>
            </Button>
          )
        }
      >
        <div className="space-y-4">
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

          {/* ─── Settings Panel ─── */}
          {showSettings && (
            <div className="space-y-4">
              <Card>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Project PIN</h3>
                    <p className="mt-1 text-xs text-gray-500">Share this PIN with your crew so they can join the project.</p>
                  </div>
                  <div className="flex gap-2">
                    {project.pin.split('').map((digit, i) => (
                      <span key={i} className="flex size-10 items-center justify-center rounded-lg bg-[#202020] text-lg font-bold text-[#0178a3]">{digit}</span>
                    ))}
                  </div>
                </div>
              </Card>
              <Card>
                <h3 className="text-sm font-semibold text-white">Project Details</h3>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <FormInput label="Project name" type="text" value={name} onChange={(e) => { setName(e.target.value); setEditError('') }} maxLength={100} />
                  <SearchableSelect
                    label="Manager"
                    value={managerId}
                    placeholder="None"
                    options={[{ value: '', label: 'None' }, ...project.members.map((m) => ({ value: String(m.userId), label: `${m.firstName} ${m.lastName}` }))]}
                    onChange={(v) => setManagerId(v)}
                  />
                  <SearchableSelect
                    label="Status"
                    value={status}
                    placeholder="Select..."
                    options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]}
                    onChange={(v) => setStatus(v)}
                  />
                </div>
                {editError && <p className="mt-3 text-sm text-red-400">{editError}</p>}
                <div className="mt-4 flex items-center justify-between">
                  <Button variant="danger" size="sm" onClick={() => setShowDeleteConfirm(true)} disabled={isPending}>Delete Project</Button>
                  <Button size="sm" onClick={handleSaveProject} disabled={isPending}>{isPending ? 'Saving...' : 'Save Changes'}</Button>
                </div>
              </Card>
              <div className="border-t border-white/10" />
            </div>
          )}

          {/* ─── Tab Switcher ─── */}
          <div className="flex w-full overflow-x-auto rounded-lg bg-[#2a2a2a] p-1 scrollbar-none sm:overflow-x-visible">
            {(() => {
              const myEqCount = equipment.filter((e) => e.assignedMemberId === currentMemberId).length
              if (isUser) {
                return [{ key: 'my-equipment' as Tab, label: 'My Equipment', count: myEqCount }]
              }
              const tabs: { key: Tab; label: string; count: number }[] = [
                { key: 'equipment', label: 'Equipment', count: equipment.length },
              ]
              if (isCrew && myEqCount > 0) {
                tabs.push({ key: 'my-equipment', label: 'My Equipment', count: myEqCount })
              }
              // Crew only see Equipment + My Equipment + Plots. Team and
              // Pick List are admin/manager surfaces.
              if (!isCrew) {
                tabs.push({ key: 'team', label: 'Team', count: project.members.length })
                tabs.push({ key: 'picklist', label: 'Pick List', count: pickListItems.filter((p) => p.type !== 'PTP').length })
              }
              tabs.push({ key: 'stage-plots', label: 'Plots', count: mockPlots.length })
              return tabs
            })().map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[#0178a3] text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-xs opacity-70">{tab.count}</span>
              </button>
            ))}
          </div>

          {/* ═══════════════════════════════ EQUIPMENT TAB ═══════════════════════════════ */}
          {activeTab === 'equipment' && (
            <>
              {/* Search + Add bar */}
              <div className="sticky top-16 z-20 -mx-4 flex items-center gap-3 bg-[#202020] px-4 pb-3 pt-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Search equipment..."
                    value={eqSearch}
                    onChange={(e) => setEqSearch(e.target.value)}
                    className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-2.5 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
                  />
                </div>
                {canAddEquipment && !showAdd && <Button onClick={() => setShowAdd(true)}><span className="sm:hidden">+</span><span className="hidden sm:inline">Add Equipment</span></Button>}
                {!canAddEquipment && isCrew && !showTeamQr && <Button onClick={() => setShowTeamQr(true)}><span className="sm:hidden">+</span><span className="hidden sm:inline">Show QR</span></Button>}
              </div>

              {/* Filter chips (admin/manager only) — categories + locations
                  share a single All button that resets both filters. Mobile
                  uses a +N more overflow so the row never wraps. */}
              {(usedEquipmentCategories.length > 0 || equipmentLocations.length > 0) && (() => {
                type ChipDef = { key: string; kind: 'cat' | 'loc'; label: string; active: boolean; onClick: () => void }
                const chips: ChipDef[] = [
                  ...usedEquipmentCategories.map((c): ChipDef => ({
                    key: `cat:${c.value}`,
                    kind: 'cat',
                    label: c.label,
                    active: eqCategoryFilter === c.value,
                    onClick: () => setEqCategoryFilter(eqCategoryFilter === c.value ? null : c.value),
                  })),
                  ...equipmentLocations.map((loc): ChipDef => ({
                    key: `loc:${loc}`,
                    kind: 'loc',
                    label: loc,
                    active: eqLocationFilter === loc,
                    onClick: () => setEqLocationFilter(eqLocationFilter === loc ? null : loc),
                  })),
                ]
                const VISIBLE_MOBILE = 3

                // limit = null means "show every chip, no +N more button" —
                // used on desktop where flex-wrap can spill onto extra rows
                // without looking cramped.
                const renderRow = (limit: number | null) => {
                  const overflow = limit != null && chips.length > limit
                  const visible = limit == null || eqChipsExpanded ? chips : chips.slice(0, limit)
                  return (
                    <>
                      <Chip
                        active={!eqCategoryFilter && !eqLocationFilter}
                        onClick={() => {
                          setEqCategoryFilter(null)
                          setEqLocationFilter(null)
                        }}
                      >
                        All
                      </Chip>
                      {visible.map((c, i) => {
                        const prev = visible[i - 1]
                        const showDivider = prev && prev.kind === 'cat' && c.kind === 'loc'
                        return (
                          <span key={c.key} className="contents">
                            {showDivider && (
                              <span aria-hidden className="flex shrink-0 items-center px-1 text-2xl font-bold leading-none text-[#22a7d3]">·</span>
                            )}
                            <Chip active={c.active} onClick={c.onClick}>
                              {c.label}
                            </Chip>
                          </span>
                        )
                      })}
                      {overflow && (
                        <button
                          type="button"
                          onClick={() => setEqChipsExpanded((v) => !v)}
                          className="rounded-md border border-white/[0.10] bg-[#2a2a2a] px-3 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-[#313131]"
                        >
                          {eqChipsExpanded ? 'Show less' : `+${chips.length - (limit as number)} more`}
                        </button>
                      )}
                    </>
                  )
                }

                return (
                  <div className="pb-3">
                    {/* Mobile: stays on a single line — `+N more` handles
                        anything that won't fit. Tap to expand and the chips
                        wrap onto multiple rows. */}
                    <div className={`gap-2 sm:hidden ${eqChipsExpanded ? 'flex flex-wrap' : 'flex flex-nowrap overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'}`}>
                      {renderRow(VISIBLE_MOBILE)}
                    </div>
                    {/* Desktop: show every chip in one row; flex-wrap allows
                        natural overflow onto a second row when truly needed. */}
                    <div className="hidden flex-wrap gap-2 sm:flex">{renderRow(null)}</div>
                  </div>
                )
              })()}

              {/* Location summary — same card as the crew /tasks page */}
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
                  }))}
                />
              )}

              {/* Crew-only: standalone join-QR card on Equipment tab */}
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

              {/* Bulk add form */}
              {canAddEquipment && showAdd && (
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Add Equipment</h3>
                    <IconButton onClick={() => { setShowAdd(false); setAddError('') }}><CloseIcon /></IconButton>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Add equipment. Each item auto-IDs by category (<span className="font-mono">PNL 1</span>, <span className="font-mono">WLBP 1</span>…). Type an ID to customize.</p>
                  <form onSubmit={(e) => { e.preventDefault(); handleBulkAdd() }}>
                    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button type="submit" disabled={isPending}>{isPending ? 'Adding...' : 'Add'}</Button>
                    </div>
                    {addError && <p className="mt-3 text-sm text-red-400">{addError}</p>}
                  </form>
                </Card>
              )}

              <p className="text-xs text-gray-500">
                {filteredEquipment.length} of {equipment.length} items
                {eqSearch && ` matching "${eqSearch}"`}
              </p>

              {filteredEquipment.length === 0 ? (
                <EmptyState icon={<WrenchIcon />} title={eqSearch ? 'No matches found' : 'No equipment yet'} message={eqSearch ? 'Try a different search term.' : 'Add equipment using the button above.'} />
              ) : (
                <div className="space-y-2">
                  {filteredEquipment.map((item) => {
                    const isEditing = editingEqId === item.id
                    return (
                      <div key={item.id} className="flex items-start gap-4 rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-colors hover:bg-[#313131]">
                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <form onSubmit={(e) => { e.preventDefault(); handleSaveEquipment(item) }}>
                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <FormInput compact label="ID" type="text" value={(editEqData.name as string) || ''} onChange={(e) => setEditEqData({ ...editEqData, name: e.target.value })} />
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
                                    setEditEqData({
                                      ...editEqData,
                                      hardwareType: v || null,
                                      ...(autoHeadset ? { headsetType: autoHeadset } : {}),
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
                                {hasField(item.category, 'ipAddress') && (
                                  <FormInput compact label="IP Address" type="text" value={(editEqData.ipAddress as string) || ''} onChange={(e) => setEditEqData({ ...editEqData, ipAddress: e.target.value })} />
                                )}
                                {hasField(item.category, 'patch') && (
                                  <FormInput compact label="Patch" type="text" value={(editEqData.patch as string) || ''} onChange={(e) => setEditEqData({ ...editEqData, patch: e.target.value })} />
                                )}
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
                              <div className="mt-3 flex items-center justify-end gap-3">
                                <Button type="submit" size="sm" disabled={isPending}>Save</Button>
                                <Button type="button" size="sm" variant="danger" onClick={() => handleDeleteEquipment(item)} disabled={isPending}>Delete</Button>
                                <Button type="button" size="sm" variant="secondary" onClick={() => setEditingEqId(null)} disabled={isPending}>Cancel</Button>
                              </div>
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
                                        setActiveTab('my-equipment')
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
                                  <span
                                    className={`transition-colors duration-500 ${item.ipAddress && reachable[item.id] ? 'text-green-400' : 'text-white'}`}
                                    title={item.ipAddress && reachable[item.id] ? `${item.ipAddress} — reachable` : undefined}
                                  >
                                    {item.name}
                                  </span>
                                )}
                                {/* Assignee: inline on desktop, own row on mobile */}
                                {item.assignedToName ? (
                                  <>
                                    <span className="hidden sm:inline text-gray-500"> · </span>
                                    <span className="hidden sm:inline text-[#22a7d3]">
                                      {item.assignedToName}
                                      {item.assignedToPosition && <span className="text-[#22a7d3]/70"> · {item.assignedToPosition}</span>}
                                    </span>
                                    <div className="sm:hidden mt-0.5 text-[#22a7d3] font-normal">
                                      {item.assignedToName}
                                      {item.assignedToPosition && <span className="text-[#22a7d3]/70"> · {item.assignedToPosition}</span>}
                                    </div>
                                  </>
                                ) : isAssignable(item.category) ? (
                                  <>
                                    <span className="hidden sm:inline text-gray-500"> · </span>
                                    <span className="hidden sm:inline italic text-gray-400">Unassigned</span>
                                    <div className="sm:hidden mt-0.5 italic text-gray-400 font-normal">Unassigned</div>
                                  </>
                                ) : null}
                              </div>

                              {/* Row 2: details — stacked with labels on mobile, inline on desktop */}
                              <div className="mt-1 text-sm text-gray-300">
                                {/* Mobile: each field on its own row */}
                                <div className="flex flex-col gap-0.5 sm:hidden">
                                  {item.location && <span><span className="text-xs text-gray-500">Location: </span>{item.location}</span>}
                                  {item.hardwareType && <span><span className="text-xs text-gray-500">Hardware: </span>{item.hardwareType}</span>}
                                  {item.headsetType && <span><span className="text-xs text-gray-500">Headset: </span>{item.headsetType}</span>}
                                  {item.ipAddress && <span><span className="text-xs text-gray-500">IP: </span><a href={`http://${item.ipAddress}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#22a7d3] underline decoration-[#22a7d3]/30 hover:decoration-[#22a7d3]">{item.ipAddress}</a></span>}
                                  {item.patch && <span><span className="text-xs text-gray-500">Patch: </span><span className="font-mono">{item.patch}</span></span>}
                                  {item.gooseneck && <span><span className="text-xs text-gray-500">Misc: </span>Gooseneck</span>}
                                  {item.footswitches > 0 && <span><span className="text-xs text-gray-500">FS: </span>{item.footswitches}</span>}
                                  {item.speakers > 0 && <span><span className="text-xs text-gray-500">SPK: </span>{item.speakers}</span>}
                                </div>
                                {/* Desktop: inline with dots (original layout) */}
                                <div className="hidden sm:flex flex-wrap items-center gap-x-1.5">
                                  {item.location && <><span className="text-xs text-gray-500">Location: </span><span>{item.location}</span><span className="text-gray-500">·</span></>}
                                  {item.hardwareType && <><span className="text-xs text-gray-500">Hardware: </span><span>{item.hardwareType}</span></>}
                                  {item.headsetType && <><span className="text-gray-500">·</span><span className="text-xs text-gray-500">Headset: </span><span>{item.headsetType}</span></>}
                                  {item.ipAddress && <><span className="text-gray-500">·</span><span className="text-xs text-gray-500">IP: </span><a href={`http://${item.ipAddress}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#22a7d3] underline decoration-[#22a7d3]/30 hover:decoration-[#22a7d3]">{item.ipAddress}</a></>}
                                  {item.patch && <><span className="text-gray-500">·</span><span className="text-xs text-gray-500">Patch: </span><span className="font-mono">{item.patch}</span></>}
                                  {item.gooseneck && <><span className="text-gray-500">·</span><span>Gooseneck</span></>}
                                  {item.footswitches > 0 && <><span className="text-gray-500">·</span><span className="text-xs text-gray-500">FS: </span><span>{item.footswitches}</span></>}
                                  {item.speakers > 0 && <><span className="text-gray-500">·</span><span className="text-xs text-gray-500">SPK: </span><span>{item.speakers}</span></>}
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Status + Edit */}
                        {!isEditing && (
                          <div className="flex shrink-0 items-center gap-2">
                            {canChangeStatus ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-medium text-gray-400">Status</span>
                                <DeployStatusSelect
                                  value={item.deployStatus}
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
                              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_STYLES[item.deployStatus] || STATUS_BADGE_STYLES.na}`}>
                                {getStatusLabel(item.deployStatus)}
                              </span>
                            )}
                            {canEditEquipment && <Button size="sm" onClick={() => startEqEdit(item)}>Edit</Button>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ═══════════════════════════════ TEAM TAB ═══════════════════════════════ */}
          {activeTab === 'team' && (
            <>
              <div className="sticky top-16 z-20 -mx-4 flex items-center gap-3 bg-[#202020] px-4 pb-3 pt-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Search by name, position, role, equipment, or status..."
                    value={teamSearch}
                    onChange={(e) => setTeamSearch(e.target.value)}
                    className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-2.5 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
                  />
                </div>
                {canEditTeam && !showAddMember && <Button onClick={() => setShowAddMember(true)}><span className="sm:hidden">+</span><span className="hidden sm:inline">Add Member</span></Button>}
                {!canEditTeam && isCrew && !showTeamQr && <Button onClick={() => setShowTeamQr(true)}><span className="sm:hidden">+</span><span className="hidden sm:inline">Show QR</span></Button>}
              </div>

              {/* Filter chips: assignable equipment categories only — Team
                  members never own infra gear (switches/antennas/audio). */}
              {!isCrew && (
                <FilterBar
                  options={usedEquipmentCategories
                    .filter((c) => c.assignable)
                    .map((c) => ({ value: c.value, label: c.label }))}
                  selected={teamCategoryFilter}
                  onSelect={setTeamCategoryFilter}
                />
              )}

              {/* Crew-only: standalone join-QR card */}
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

              {/* Add member form */}
              {canEditTeam && showAddMember && (
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Add Member</h3>
                    <IconButton onClick={() => setShowAddMember(false)}><CloseIcon /></IconButton>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Members are added automatically when they join with the project PIN. You can also add members manually.</p>
                  <form onSubmit={(e) => { e.preventDefault(); handleAddMember() }}>
                    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <FormInput autoFocus label="First Name" type="text" value={addMemberData.firstName} onChange={(e) => setAddMemberData({ ...addMemberData, firstName: e.target.value })} />
                      <FormInput label="Last Name" type="text" value={addMemberData.lastName} onChange={(e) => setAddMemberData({ ...addMemberData, lastName: e.target.value })} />
                      <FormInput label="Position" type="text" value={addMemberData.position} onChange={(e) => setAddMemberData({ ...addMemberData, position: e.target.value })} />
                      <SearchableSelect
                        label="Role"
                        value={addMemberData.role}
                        placeholder="Select..."
                        options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
                        onChange={(v) => setAddMemberData({ ...addMemberData, role: v })}
                      />
                    </div>
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!addMemberData.firstName.trim() || !addMemberData.lastName.trim()}
                        onClick={() => {
                          const name = `${addMemberData.firstName.trim()} ${addMemberData.lastName.trim()}`
                          // Always use the production URL for the QR / invite link so scanning
                          // from a phone works regardless of where the admin is browsing from
                          // (localhost dev, preview deploys, etc.).
                          const joinUrl = `https://versacom-app.vercel.app/login/join?pin=${project.pin}`
                          const text = `Hi ${name}, you've been accepted into ${project.name}! Scan or tap: ${joinUrl}`
                          navigator.clipboard.writeText(text).then(() => showToast('success', 'Invite message copied to clipboard'))
                        }}
                      >
                        Invite
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setShowJoinQr((v) => !v)}
                      >
                        {showJoinQr ? 'Hide QR' : 'QR'}
                      </Button>
                      <Button type="submit" disabled={isPending || !addMemberData.firstName.trim() || !addMemberData.lastName.trim()}>{isPending ? 'Adding...' : 'Add'}</Button>
                    </div>
                    {showJoinQr && (() => {
                      const joinUrl = `https://versacom-app.vercel.app/login/join?pin=${project.pin}`
                      return (
                        <div className="mt-4 flex flex-col items-center gap-3">
                          <div className="rounded-xl bg-white p-3">
                            <QRCodeSVG value={joinUrl} size={192} level="M" />
                          </div>
                          <span className="font-mono text-[11px] text-gray-400 break-all text-center">{joinUrl}</span>
                        </div>
                      )
                    })()}
                  </form>
                </Card>
              )}

              <p className="text-xs text-gray-500">
                {filteredMembers.length} of {project.members.length} members
                {teamSearch && ` matching "${teamSearch}"`}
              </p>

              {filteredMembers.length === 0 ? (
                <EmptyState icon={<UsersIcon />} title={teamSearch ? 'No matches found' : 'No team members yet'} message={teamSearch ? 'Try a different search term.' : 'Members join via the project PIN.'} />
              ) : (
                <div className="space-y-2">
                  {filteredMembers.map((m) => {
                    const isEditing = editingMemberId === m.id
                    return (
                      <div key={m.id} className="rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-colors hover:bg-[#313131]">
                        {isEditing ? (
                          <form onSubmit={(e) => { e.preventDefault(); handleSaveMember(m) }}>
                            <div className="text-sm font-semibold text-white">
                              {m.firstName} {m.lastName}
                              {m.position && <span className="text-gray-500"> · {m.position}</span>}
                              <span className="text-gray-500"> · {ROLE_LABELS[m.role] || m.role}</span>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <FormInput compact label="First Name" type="text" value={editMemberData.firstName} onChange={(e) => setEditMemberData({ ...editMemberData, firstName: e.target.value })} />
                              <FormInput compact label="Last Name" type="text" value={editMemberData.lastName} onChange={(e) => setEditMemberData({ ...editMemberData, lastName: e.target.value })} />
                              <FormInput compact label="Position" type="text" value={editMemberData.position} onChange={(e) => setEditMemberData({ ...editMemberData, position: e.target.value })} />
                              <SearchableSelect
                                compact
                                label="Role"
                                value={editMemberData.role}
                                placeholder="Select..."
                                options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
                                onChange={(v) => setEditMemberData({ ...editMemberData, role: v })}
                              />
                            </div>
                            <div className="mt-3 flex items-center justify-end gap-3">
                              <Button type="submit" size="sm" disabled={isPending}>Save</Button>
                              <Button type="button" size="sm" variant="danger" onClick={() => handleDeleteMember(m)} disabled={isPending}>Delete</Button>
                              <Button type="button" size="sm" variant="secondary" onClick={() => setEditingMemberId(null)} disabled={isPending}>Cancel</Button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-semibold text-white">
                                <span>{m.firstName} {m.lastName}</span>
                                {m.position && <span className="text-gray-400">· {m.position}</span>}
                                <span className="text-gray-400">· {ROLE_LABELS[m.role] || m.role}</span>
                                <span className={m.hasPin ? 'text-green-400' : 'text-yellow-600/80'}>
                                  · {m.hasPin ? 'Active' : 'Pending'}
                                </span>
                              </div>
                              {m.equipmentNames.length > 0 ? (
                                <div className="mt-1.5 flex items-center justify-between gap-3 text-xs font-medium">
                                  <span className="truncate text-[#22a7d3]">{m.equipmentNames.join(', ')}</span>
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
                            {canEditTeam && <Button size="sm" onClick={() => startMemberEdit(m)}>Edit</Button>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ═══════════════════════════════ PICK LIST TAB ═══════════════════════════════ */}
          {activeTab === 'picklist' && (
            <>
              <div className="sticky top-16 z-20 -mx-4 flex items-center gap-3 bg-[#202020] px-4 pb-3 pt-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Search by name, type, or user..."
                    value={plSearch}
                    onChange={(e) => setPlSearch(e.target.value)}
                    className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-2.5 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
                  />
                </div>
                <Button variant={plSortAbc ? 'primary' : 'secondary'} onClick={() => setPlSortAbc(!plSortAbc)}>A–Z</Button>
                {canEditPickList && !showAddPl && <Button onClick={() => setShowAddPl(true)}><span className="sm:hidden">+</span><span className="hidden sm:inline">Add Function</span></Button>}
              </div>

              {/* Filter chips: function types */}
              <FilterBar
                options={FUNCTION_TYPES.map((t) => ({ value: t, label: FUNCTION_TYPE_LABELS[t] || t }))}
                selected={plTypeFilter}
                onSelect={setPlTypeFilter}
              />

              {/* Add function form */}
              {canEditPickList && showAddPl && (
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Add Function</h3>
                    <IconButton onClick={() => setShowAddPl(false)}><CloseIcon /></IconButton>
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
                    <div className="mt-4 flex justify-end">
                      {(() => {
                        const hasName = !!addPlData.name.trim()
                        const qty = parseInt(addPlData.quantity, 10)
                        const ok = hasName || (Number.isFinite(qty) && qty > 0)
                        return <Button type="submit" disabled={isPending || !ok}>{isPending ? 'Adding...' : 'Add'}</Button>
                      })()}
                    </div>
                  </form>
                </Card>
              )}

              <p className="text-xs text-gray-500">
                {filteredPickList.length} of {pickListItems.filter((p) => p.type !== 'PTP').length} functions
                {plSearch && ` matching "${plSearch}"`}
              </p>

              {filteredPickList.length === 0 ? (
                <EmptyState icon={<ListIcon />} title={plSearch ? 'No matches found' : 'No functions yet'} message={plSearch ? 'Try a different search term.' : 'Add communication functions using the button above.'} />
              ) : (
                <div className="space-y-2">
                  {filteredPickList.map((item) => {
                    const isEditing = editingPlId === item.id
                    return (
                      <div key={item.id} className="rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-colors hover:bg-[#313131]">
                        {isEditing ? (
                          <form onSubmit={(e) => { e.preventDefault(); handleSavePl(item) }}>
                            <div className="flex items-center gap-2">
                              {item.code && <span className="text-sm font-semibold text-white">{item.code}</span>}
                              <span className="text-sm font-semibold text-white">{item.name}</span>
                              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-gray-300">{FUNCTION_TYPE_LABELS[item.type] || item.type}</span>
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
                            <div className="mt-3 flex items-center justify-end gap-3">
                              <Button type="submit" size="sm" disabled={isPending}>Save</Button>
                              <Button type="button" size="sm" variant="danger" onClick={() => handleDeletePl(item)} disabled={isPending}>Delete</Button>
                              <Button type="button" size="sm" variant="secondary" onClick={() => setEditingPlId(null)} disabled={isPending}>Cancel</Button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                {item.code && <span className="text-sm font-semibold text-white">{item.code}</span>}
                                <span className="text-sm font-semibold text-white">{item.name}</span>
                                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-gray-300">{FUNCTION_TYPE_LABELS[item.type] || item.type}</span>
                              </div>
                              {item.users.length > 0 ? (
                                <div className="mt-1.5 text-xs">
                                  <span className="text-[#22a7d3]">{item.users.slice(0, 3).join(', ')}</span>
                                  {item.users.length > 3 && (
                                    <span className="text-gray-500"> +{item.users.length - 3} more</span>
                                  )}
                                </div>
                              ) : (
                                <div className="mt-1.5 text-xs italic text-gray-500">Unused</div>
                              )}
                            </div>
                            {canEditPickList && <Button size="sm" onClick={() => startPlEdit(item)}>Edit</Button>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ═══════════════════════════════ STAGE PLOTS TAB ═══════════════════════════════ */}
          {activeTab === 'stage-plots' && (
            <>
              {/* Search + Add bar */}
              <div className="sticky top-16 z-20 -mx-4 flex items-center gap-3 bg-[#202020] px-4 pb-3 pt-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Search stage plots..."
                    value={plotSearch}
                    onChange={(e) => setPlotSearch(e.target.value)}
                    className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-2.5 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
                  />
                </div>
                {isAdmin && !showAddPlot && (
                  <Button onClick={() => setShowAddPlot(true)}>
                    <span className="sm:hidden">+</span>
                    <span className="hidden sm:inline">Add Plot</span>
                  </Button>
                )}
              </div>

              {/* Add plot form */}
              {isAdmin && showAddPlot && (
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Add Stage Plot</h3>
                    <IconButton onClick={() => { setShowAddPlot(false); setAddPlotLabel(''); setAddPlotUrl(''); setPlotUploadError('') }}><CloseIcon /></IconButton>
                  </div>
                  <div className="mt-4 flex flex-col gap-3">
                    <ComboboxInput
                      label="Label"
                      value={addPlotLabel}
                      options={['FOH', 'Stage Left', 'Stage Right', 'Monitors', 'Venue Blueprint', 'Drum Riser', 'Patch List', ...allLocations]}
                      onChange={setAddPlotLabel}
                    />
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-gray-400">PDF File</label>
                      <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${addPlotUrl ? 'border-green-500/50 bg-green-500/5' : 'border-white/10 hover:border-white/20'} ${plotUploading ? 'pointer-events-none opacity-50' : ''}`}>
                        <input
                          type="file"
                          accept="application/pdf"
                          className="sr-only"
                          disabled={plotUploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            setPlotUploading(true)
                            setPlotUploadError('')
                            try {
                              const form = new FormData()
                              form.append('file', file)
                              const res = await fetch('/api/stage-plots/upload', { method: 'POST', body: form })
                              const data = await res.json()
                              if (!res.ok) throw new Error(data.error || 'Upload failed')
                              setAddPlotUrl(data.url)
                            } catch (err) {
                              setPlotUploadError(err instanceof Error ? err.message : 'Upload failed')
                            } finally {
                              setPlotUploading(false)
                            }
                          }}
                        />
                        <svg xmlns="http://www.w3.org/2000/svg" className="size-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                        <span className="text-sm text-gray-300">
                          {plotUploading ? 'Uploading…' : addPlotUrl ? '✓ Uploaded — tap to replace' : 'Tap to choose PDF'}
                        </span>
                      </label>
                      {plotUploadError && <p className="mt-1.5 text-xs text-red-400">{plotUploadError}</p>}
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button
                      type="button"
                      disabled={!addPlotLabel.trim() || !addPlotUrl.trim() || plotUploading}
                      onClick={() => {
                        setMockPlots((prev) => [...prev, { id: Date.now(), label: addPlotLabel.trim(), url: addPlotUrl.trim() }])
                        setAddPlotLabel('')
                        setAddPlotUrl('')
                        setShowAddPlot(false)
                        setPlotUploadError('')
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </Card>
              )}

              <p className="text-xs text-gray-500">
                {filteredPlots.length} of {mockPlots.length} {mockPlots.length === 1 ? 'plot' : 'plots'}
                {plotSearch && ` matching "${plotSearch}"`}
              </p>

              {filteredPlots.length === 0 ? (
                <EmptyState
                  icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>}
                  title={plotSearch ? 'No matches found' : 'No stage plots yet'}
                  message={plotSearch ? 'Try a different search term.' : isAdmin ? 'Add a PDF link to share venue layouts with your crew.' : 'No stage plots have been added yet.'}
                />
              ) : (
                <div className="space-y-2">
                  {filteredPlots.map((plot) => {
                    const isEditingPlot = editingPlotId === plot.id
                    return (
                      <div key={plot.id} className="rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-colors hover:bg-[#313131]">
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
                                <label className="mb-1.5 block text-xs font-medium text-gray-400">PDF File</label>
                                <label className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed px-4 py-4 transition-colors border-green-500/50 bg-green-500/5 hover:border-white/20 ${plotUploading ? 'pointer-events-none opacity-50' : ''}`}>
                                  <input
                                    type="file"
                                    accept="application/pdf"
                                    className="sr-only"
                                    disabled={plotUploading}
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0]
                                      if (!file) return
                                      setPlotUploading(true)
                                      setPlotUploadError('')
                                      try {
                                        const form = new FormData()
                                        form.append('file', file)
                                        const res = await fetch('/api/stage-plots/upload', { method: 'POST', body: form })
                                        const data = await res.json()
                                        if (!res.ok) throw new Error(data.error || 'Upload failed')
                                        setEditPlotData((prev) => ({ ...prev, url: data.url }))
                                      } catch (err) {
                                        setPlotUploadError(err instanceof Error ? err.message : 'Upload failed')
                                      } finally {
                                        setPlotUploading(false)
                                      }
                                    }}
                                  />
                                  <svg xmlns="http://www.w3.org/2000/svg" className="size-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                                  <span className="text-sm text-gray-300">{plotUploading ? 'Uploading…' : '✓ PDF uploaded — tap to replace'}</span>
                                </label>
                                {plotUploadError && <p className="mt-1.5 text-xs text-red-400">{plotUploadError}</p>}
                              </div>
                            </div>
                            <div className="mt-3 flex items-center justify-end gap-3">
                              <Button
                                size="sm"
                                disabled={!editPlotData.label.trim() || !editPlotData.url.trim()}
                                onClick={() => {
                                  setMockPlots((prev) => prev.map((p) => p.id === plot.id ? { ...p, ...editPlotData } : p))
                                  setEditingPlotId(null)
                                }}
                              >
                                Save
                              </Button>
                              <Button size="sm" variant="danger" onClick={() => setMockPlots((prev) => prev.filter((p) => p.id !== plot.id))}>Delete</Button>
                              <Button size="sm" variant="secondary" onClick={() => setEditingPlotId(null)}>Cancel</Button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-white">{plot.label}</span>
                            <div className="flex shrink-0 items-center gap-2">
                              <a
                                href={plot.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/20"
                              >
                                Open PDF
                              </a>
                              {isAdmin && (
                                <Button
                                  size="sm"
                                  onClick={() => { setEditingPlotId(plot.id); setEditPlotData({ label: plot.label, url: plot.url }) }}
                                >
                                  Edit
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ═══════════════════════════════ MY EQUIPMENT TAB (User role) ═══════════════════════════════ */}
          {activeTab === 'my-equipment' && (() => {
            const myEquipment = equipment.filter((e) => e.assignedMemberId === currentMemberId)
            const isPanelType = (cat: string) => ['panels', 'hardwire_bp', 'wireless_bp'].includes(cat)
            return (
              <>
                <p className="text-xs text-gray-500">
                  {myEquipment.length} item{myEquipment.length !== 1 ? 's' : ''} assigned to you
                </p>

                {myEquipment.length === 0 ? (
                  <EmptyState icon={<WrenchIcon />} title="No equipment assigned" message="You don't have any equipment assigned to you yet." />
                ) : (
                  <div className="space-y-2">
                    {myEquipment.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-start gap-4 rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-colors ${isPanelType(item.category) ? 'cursor-pointer hover:bg-[#313131]' : ''}`}
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
                            {item.ipAddress && <><span className="text-gray-500">·</span><span className="hidden sm:inline text-gray-500">IP: </span><a href={`http://${item.ipAddress}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#22a7d3] underline decoration-[#22a7d3]/30 hover:decoration-[#22a7d3]" onClick={(e) => e.stopPropagation()}>{item.ipAddress}</a></>}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_STYLES[item.deployStatus] || STATUS_BADGE_STYLES.na}`}>
                          {getStatusLabel(item.deployStatus)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </PageLayout>

      <Modal
        open={showDeleteConfirm}
        title="Delete Project"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)} disabled={isPending}>Cancel</Button>
            <Button variant="danger" onClick={handleDeleteProject} disabled={isPending}>{isPending ? 'Deleting...' : 'Delete'}</Button>
          </>
        }
      >
        Are you sure you want to delete <span className="text-white font-medium">{project.name}</span>? This will remove all members and cannot be undone.
      </Modal>
    </AppShell>
  )
}
