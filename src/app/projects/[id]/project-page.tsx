'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
  panels: ['RSP-1232', 'RSP-1216', 'DSP-1216', 'KP-5032', 'KP32', 'RSP-2318', 'RSP-2312'],
  wireless_bp: ['Bolero', 'Freespeak', 'Pliant'],
  hardwire_bp: ['Helixnet', 'DBP', 'ST-374', 'ST370', 'C3', 'BP325'],
  switches: ['26P+4F', '9P+1F', 'Intellanet Old', 'Intellanet New', 'Media', 'Antaira', 'TP Link'],
  antennas: ['Bolero 1.9', 'Bolero 2.4', 'Pliant', 'Freespeak 1.9', 'Freespeak 2.4'],
  audio: ['NA2', 'A16r', 'Dark88'],
}

const HEADSET_TYPES = [
  'LWHS 4', 'LWHS 5', 'PH 88', 'Shure Single', 'Shure Double',
  'Pliant Single', 'Pliant Double', 'Max D2', 'DT 200', 'DT 280',
  'DT 290', 'Dave Clark', 'Peltor', 'Dalcom',
]

const DEPLOY_STATUSES = [
  { value: 'na', label: 'N/A' },
  { value: 'deployed', label: 'Deployed' },
  { value: 'done', label: 'Done' },
  { value: 'returned', label: 'Returned' },
  { value: 'not-needed', label: 'Not Needed' },
  { value: 'damaged', label: 'Damaged' },
] as const

const STATUS_BADGE_STYLES: Record<string, string> = {
  na: 'bg-gray-500/15 text-gray-400',
  deployed: 'bg-green-500/15 text-green-400',
  done: 'bg-blue-500/15 text-blue-400',
  returned: 'bg-purple-500/15 text-purple-400',
  'not-needed': 'bg-yellow-500/15 text-yellow-400',
  damaged: 'bg-red-500/15 text-red-400',
}

const FUNCTION_TYPES = ['CONF', 'IFB', 'Audio_IO'] as const
const FUNCTION_TYPE_LABELS: Record<string, string> = {
  CONF: 'CONF',
  IFB: 'IFB',
  Audio_IO: 'Audio I/O',
}

const ROLES = ['admin', 'manager', 'crew', 'user'] as const
const ROLE_LABELS: Record<string, string> = { admin: 'Admin', manager: 'Manager', crew: 'Crew', user: 'User' }

/* ─── Types ─── */

type Tab = 'equipment' | 'team' | 'picklist' | 'my-equipment'

type Member = {
  id: number
  role: string
  position: string | null
  location: string | null
  userId: number
  firstName: string
  lastName: string
  equipmentNames: string[]
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
  deployStatus: string
  assignedToId: number | null
  assignedToName: string | null
  assignedToPosition: string | null
  assignedMemberId: number | null
}

type AssignableMember = { id: number; name: string }

type PickListItemType = { id: number; name: string; type: string }

/* ─── Helpers ─── */

function isAssignable(category: string) {
  return ['panels', 'wireless_bp', 'hardwire_bp'].includes(category)
}

function getCategoryLabel(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label || value
}

function hasField(category: string, field: string) {
  const panelFields = ['location', 'headsetType', 'ipAddress']
  const wirelessFields = ['headsetType']
  const hardwireFields = ['location', 'headsetType', 'ipAddress']
  const infraFields = ['location', 'ipAddress']
  if (category === 'panels') return panelFields.includes(field)
  if (category === 'wireless_bp') return wirelessFields.includes(field)
  if (category === 'hardwire_bp') return hardwireFields.includes(field)
  if (['switches', 'antennas'].includes(category)) return infraFields.includes(field)
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

  // Role permissions (based on role within this project)
  const isProjectAdmin = currentUserRole === 'admin'
  const isManager = currentUserRole === 'manager'
  const isCrew = currentUserRole === 'crew'
  const isUser = currentUserRole === 'user'
  const canEditEquipment = isProjectAdmin
  const canEditTeam = isProjectAdmin || isManager
  const canEditPickList = isProjectAdmin
  const canChangeStatus = isProjectAdmin || isManager || isCrew
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

  // Equipment state
  const [eqSearch, setEqSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addCategory, setAddCategory] = useState('panels')
  const [addHardwareType, setAddHardwareType] = useState('')
  const [addQuantity, setAddQuantity] = useState(1)
  const [addError, setAddError] = useState('')
  const [editingEqId, setEditingEqId] = useState<number | null>(null)
  const [editEqData, setEditEqData] = useState<Partial<EquipmentItem>>({})

  // Team state
  const [teamSearch, setTeamSearch] = useState('')
  const [showAddMember, setShowAddMember] = useState(false)
  const [addMemberData, setAddMemberData] = useState<{ firstName: string; lastName: string; position: string; role: string }>({ firstName: '', lastName: '', position: '', role: 'user' })
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null)
  const [editMemberData, setEditMemberData] = useState<{ firstName: string; lastName: string; position: string; role: string }>({ firstName: '', lastName: '', position: '', role: 'crew' })

  // Pick list state
  const [plSearch, setPlSearch] = useState('')
  const [plSortAbc, setPlSortAbc] = useState(false)
  const [editingPlId, setEditingPlId] = useState<number | null>(null)
  const [editPlData, setEditPlData] = useState<{ name: string; type: string }>({ name: '', type: 'CONF' })
  const [showAddPl, setShowAddPl] = useState(false)
  const [addPlData, setAddPlData] = useState<{ name: string; type: string }>({ name: '', type: 'CONF' })

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
    if (addQuantity < 1) { setAddError('Quantity must be at least 1'); return }
    setAddError('')
    startTransition(async () => {
      const result = await bulkCreateEquipment(project.id, addCategory, addHardwareType, addQuantity)
      if (result.error) { setAddError(result.error); return }
      showToast('success', `Added ${result.count} ${getCategoryLabel(addCategory)}`)
      setShowAdd(false)
      setAddHardwareType('')
      setAddQuantity(1)
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
      deployStatus: item.deployStatus,
      assignedToId: item.assignedMemberId,
    })
  }

  function handleSaveEquipment(item: EquipmentItem) {
    startTransition(async () => {
      const result = await updateEquipment(project.id, item.id, {
        name: editEqData.name || item.name,
        hardwareType: (editEqData.hardwareType as string) || null,
        position: null,
        location: hasField(item.category, 'location') ? (editEqData.location as string) || null : null,
        headsetType: hasField(item.category, 'headsetType') ? (editEqData.headsetType as string) || null : null,
        ipAddress: hasField(item.category, 'ipAddress') ? (editEqData.ipAddress as string) || null : null,
        deployStatus: (editEqData.deployStatus as string) || 'na',
        assignedToId: isAssignable(item.category) ? (editEqData.assignedToId as number | null) : null,
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
    setEditPlData({ name: item.name, type: item.type })
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
    if (!addPlData.name.trim()) return
    startTransition(async () => {
      const result = await createPickListItem(project.id, addPlData)
      if (result.error) { showToast('error', result.error); return }
      showToast('success', `${addPlData.name} added`)
      setShowAddPl(false)
      setAddPlData({ name: '', type: 'CONF' })
      router.refresh()
    })
  }

  /* ─── Filtered lists ─── */

  const filteredEquipment = equipment.filter((e) => {
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

  const filteredMembers = project.members
    .filter((m) => {
      if (!teamSearch) return true
      const q = teamSearch.toLowerCase()
      return (
        m.firstName.toLowerCase().includes(q) ||
        m.lastName.toLowerCase().includes(q) ||
        (m.position?.toLowerCase().includes(q) ?? false) ||
        m.role.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' }))

  const filteredPickList = pickListItems
    .filter((p) => {
      if (!plSearch) return true
      const q = plSearch.toLowerCase()
      return p.name.toLowerCase().includes(q) || (FUNCTION_TYPE_LABELS[p.type] || p.type).toLowerCase().includes(q)
    })
    .sort((a, b) => plSortAbc ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : 0)

  /* ─── Tab action buttons ─── */

  const tabActionButton = activeTab === 'equipment' ? (
    !showAdd && <Button onClick={() => setShowAdd(true)}>Add Equipment</Button>
  ) : activeTab === 'team' ? (
    !showAddMember && <Button onClick={() => setShowAddMember(true)}>Add Member</Button>
  ) : (
    !showAddPl && <Button onClick={() => setShowAddPl(true)}>Add Function</Button>
  )

  return (
    <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly}>
      <PageLayout
        title={project.name}
        action={
          <div className="flex items-center gap-2">
            {canSeeSettings && (
              <Button variant="secondary" onClick={() => setShowSettings(!showSettings)}>
                <span className="flex items-center gap-1.5">
                  <GearIcon />
                  {showSettings ? 'Close' : 'Edit'}
                </span>
              </Button>
            )}
            <Button variant="secondary" onClick={() => router.push('/projects')}>Back</Button>
          </div>
        }
      >
        <div className="space-y-4">
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
          <div className="flex w-full rounded-lg bg-[#2a2a2a] p-1">
            {(isUser
              ? [
                  { key: 'my-equipment' as Tab, label: 'My Equipment', count: equipment.filter((e) => e.assignedMemberId === currentMemberId).length },
                ]
              : [
                  { key: 'equipment' as Tab, label: 'Equipment', count: equipment.length },
                  { key: 'team' as Tab, label: 'Team', count: project.members.length },
                  { key: 'picklist' as Tab, label: 'Pick List', count: pickListItems.length },
                ]
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
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
                {canEditEquipment && !showAdd && <Button onClick={() => setShowAdd(true)}>Add Equipment</Button>}
              </div>

              {/* Bulk add form */}
              {canEditEquipment && showAdd && (
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Add Equipment</h3>
                    <IconButton onClick={() => { setShowAdd(false); setAddError('') }}><CloseIcon /></IconButton>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Add equipment in bulk by category and quantity. Each item can be edited individually to assign team members, locations, and hardware details.</p>
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                    <FormInput label="Quantity" type="number" inputMode="numeric" pattern="[0-9]*" min={1} max={200} value={addQuantity}
                      onChange={(e) => { const val = e.target.value.replace(/\D/g, ''); setAddQuantity(val ? parseInt(val) : 1) }} />
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button onClick={handleBulkAdd} disabled={isPending}>{isPending ? 'Adding...' : 'Add'}</Button>
                  </div>
                  {addError && <p className="mt-3 text-sm text-red-400">{addError}</p>}
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
                            <>
                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <FormInput compact label="ID" type="text" value={(editEqData.name as string) || ''} onChange={(e) => setEditEqData({ ...editEqData, name: e.target.value })} />
                                <SearchableSelect
                                  compact
                                  label="Hardware"
                                  value={(editEqData.hardwareType as string) || ''}
                                  placeholder="None"
                                  options={[{ value: '', label: 'None' }, ...(HARDWARE_TYPES[item.category] || []).map((ht) => ({ value: ht, label: ht }))]}
                                  onChange={(v) => setEditEqData({ ...editEqData, hardwareType: v || null })}
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
                                  <FormInput compact label="Location" type="text" value={(editEqData.location as string) || ''} onChange={(e) => setEditEqData({ ...editEqData, location: e.target.value })} />
                                )}
                                {hasField(item.category, 'ipAddress') && (
                                  <FormInput compact label="IP Address" type="text" value={(editEqData.ipAddress as string) || ''} onChange={(e) => setEditEqData({ ...editEqData, ipAddress: e.target.value })} />
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
                              </div>
                              <div className="mt-3 flex items-center justify-end gap-3">
                                <Button size="sm" onClick={() => handleSaveEquipment(item)} disabled={isPending}>Save</Button>
                                <Button size="sm" variant="danger" onClick={() => handleDeleteEquipment(item)} disabled={isPending}>Delete</Button>
                                <Button size="sm" variant="secondary" onClick={() => setEditingEqId(null)} disabled={isPending}>Cancel</Button>
                              </div>
                            </>
                          ) : (
                            <>
                              {/* Row 1: User · Position + ID */}
                              <div className="text-sm font-semibold">
                                {item.assignedToName ? (
                                  <span className="text-[#22a7d3]">
                                    {item.assignedToName}
                                    {item.assignedToPosition && <span className="text-[#22a7d3]/70"> · {item.assignedToPosition}</span>}
                                  </span>
                                ) : isAssignable(item.category) ? (
                                  <span className="italic text-gray-400">
                                    Unassigned
                                  </span>
                                ) : null}
                                {(item.assignedToName || isAssignable(item.category)) && <span className="text-gray-500"> · </span>}
                                <span className="text-sm font-semibold text-white">{item.name}</span>
                              </div>

                              {/* Row 2: Location · Hardware · Headset · IP */}
                              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-gray-300">
                                {item.location && <><span className="hidden text-xs text-gray-500 sm:inline">Location: </span><span>{item.location}</span><span className="text-gray-500">·</span></>}
                                {item.hardwareType && <><span className="hidden text-xs text-gray-500 sm:inline">Hardware: </span><span>{item.hardwareType}</span></>}
                                {item.headsetType && <><span className="text-gray-500">·</span><span className="hidden text-xs text-gray-500 sm:inline">Headset: </span><span>{item.headsetType}</span></>}
                                {item.ipAddress && <><span className="text-gray-500">·</span><span className="hidden text-xs text-gray-500 sm:inline">IP: </span><span className="font-mono">{item.ipAddress}</span></>}
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
                                <select
                                  value={item.deployStatus}
                                  onChange={(e) => {
                                    const newStatus = e.target.value
                                    startTransition(async () => {
                                      const result = await updateEquipment(project.id, item.id, { deployStatus: newStatus })
                                      if (result.error) { showToast('error', result.error); return }
                                      router.refresh()
                                    })
                                  }}
                                  className={`appearance-none rounded-full px-2.5 py-1 text-xs font-medium outline-none cursor-pointer ${STATUS_BADGE_STYLES[item.deployStatus] || STATUS_BADGE_STYLES.na}`}
                                >
                                  {DEPLOY_STATUSES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
                                </select>
                              </div>
                            ) : (
                              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_STYLES[item.deployStatus] || STATUS_BADGE_STYLES.na}`}>
                                {DEPLOY_STATUSES.find((s) => s.value === item.deployStatus)?.label || 'N/A'}
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
                    placeholder="Search team members..."
                    value={teamSearch}
                    onChange={(e) => setTeamSearch(e.target.value)}
                    className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-2.5 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
                  />
                </div>
                {canEditTeam && !showAddMember && <Button onClick={() => setShowAddMember(true)}>Add Member</Button>}
              </div>

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
                      <FormInput label="First Name" type="text" value={addMemberData.firstName} onChange={(e) => setAddMemberData({ ...addMemberData, firstName: e.target.value })} />
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
                    <div className="mt-4 flex justify-end">
                      <Button type="submit" disabled={isPending || !addMemberData.firstName.trim() || !addMemberData.lastName.trim()}>{isPending ? 'Adding...' : 'Add'}</Button>
                    </div>
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
                          <>
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
                              <Button size="sm" onClick={() => handleSaveMember(m)} disabled={isPending}>Save</Button>
                              <Button size="sm" variant="danger" onClick={() => handleDeleteMember(m)} disabled={isPending}>Delete</Button>
                              <Button size="sm" variant="secondary" onClick={() => setEditingMemberId(null)} disabled={isPending}>Cancel</Button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-sm font-semibold text-white">
                                {m.firstName} {m.lastName}
                                {m.position && <span className="text-gray-400"> · {m.position}</span>}
                                <span className="text-gray-400"> · {ROLE_LABELS[m.role] || m.role}</span>
                              </div>
                              {m.equipmentNames.length > 0 ? (
                                <div className="mt-1.5 text-xs font-medium text-[#22a7d3]">{m.equipmentNames.join(', ')}</div>
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
                    placeholder="Search functions..."
                    value={plSearch}
                    onChange={(e) => setPlSearch(e.target.value)}
                    className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-2.5 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
                  />
                </div>
                <Button variant={plSortAbc ? 'primary' : 'secondary'} onClick={() => setPlSortAbc(!plSortAbc)}>A–Z</Button>
                {canEditPickList && !showAddPl && <Button onClick={() => setShowAddPl(true)}>Add Function</Button>}
              </div>

              {/* Add function form */}
              {canEditPickList && showAddPl && (
                <Card>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Add Function</h3>
                    <IconButton onClick={() => setShowAddPl(false)}><CloseIcon /></IconButton>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Add communication functions like conferences, IFBs, and audio I/O channels. These will be available as key options on panels.</p>
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <FormInput label="Name" type="text" value={addPlData.name} onChange={(e) => setAddPlData({ ...addPlData, name: e.target.value })} />
                    <SearchableSelect
                      label="Type"
                      value={addPlData.type}
                      placeholder="Select..."
                      options={FUNCTION_TYPES.map((t) => ({ value: t, label: FUNCTION_TYPE_LABELS[t] }))}
                      onChange={(v) => setAddPlData({ ...addPlData, type: v })}
                    />
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button onClick={handleAddPl} disabled={isPending || !addPlData.name.trim()}>{isPending ? 'Adding...' : 'Add'}</Button>
                  </div>
                </Card>
              )}

              <p className="text-xs text-gray-500">
                {filteredPickList.length} of {pickListItems.length} functions
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
                          <>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-white">{item.name}</span>
                              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-gray-300">{FUNCTION_TYPE_LABELS[item.type] || item.type}</span>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                              <Button size="sm" onClick={() => handleSavePl(item)} disabled={isPending}>Save</Button>
                              <Button size="sm" variant="danger" onClick={() => handleDeletePl(item)} disabled={isPending}>Delete</Button>
                              <Button size="sm" variant="secondary" onClick={() => setEditingPlId(null)} disabled={isPending}>Cancel</Button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-white">{item.name}</span>
                              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-gray-300">{FUNCTION_TYPE_LABELS[item.type] || item.type}</span>
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

          {/* ═══════════════════════════════ MY EQUIPMENT TAB (User role) ═══════════════════════════════ */}
          {activeTab === 'my-equipment' && (() => {
            const myEquipment = equipment.filter((e) => e.assignedMemberId === currentMemberId)
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
                      <div key={item.id} className="flex items-start gap-4 rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-colors hover:bg-[#313131]">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">
                            <span className="text-xs font-semibold text-gray-400">{item.name}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-400">
                            {item.location && <><span className="hidden sm:inline text-gray-500">Location: </span><span>{item.location}</span><span className="text-gray-500">·</span></>}
                            {item.hardwareType && <><span className="hidden sm:inline text-gray-500">Hardware: </span><span>{item.hardwareType}</span></>}
                            {item.headsetType && <><span className="text-gray-500">·</span><span className="hidden sm:inline text-gray-500">Headset: </span><span>{item.headsetType}</span></>}
                            {item.ipAddress && <><span className="text-gray-500">·</span><span className="hidden sm:inline text-gray-500">IP: </span><span className="font-mono">{item.ipAddress}</span></>}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_STYLES[item.deployStatus] || STATUS_BADGE_STYLES.na}`}>
                          {DEPLOY_STATUSES.find((s) => s.value === item.deployStatus)?.label || 'N/A'}
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
