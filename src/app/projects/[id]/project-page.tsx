'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/button'
import { showToast } from '@/components/toast'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'
import { Card } from '@/components/card'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { IconButton } from '@/components/icon-button'
import { Modal } from '@/components/modal'
import { FormInput, FormSelect } from '@/components/form-field'
import { updateProject, deleteProject } from './actions'
import { bulkCreateEquipment, updateEquipment, deleteEquipment } from './distribution/actions'

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
  panels: ['RSP-1232', 'Bolero'],
  wireless_bp: ['Bolero'],
  hardwire_bp: ['Helixnet'],
  switches: ['26P+4F', '9P+1F', 'Intellanet Old', 'Intellanet New', 'Media', 'Antaira', 'TP Link'],
  antennas: [],
  audio: ['NA2', 'A16r', 'Dark88'],
}

const DEPLOY_STATUSES = [
  { value: 'na', label: 'N/A' },
  { value: 'deployed', label: 'Deployed' },
  { value: 'done', label: 'Done' },
  { value: 'returned', label: 'Returned' },
  { value: 'not-needed', label: 'Not Needed' },
  { value: 'damaged', label: 'Damaged' },
] as const

const STATUS_COLORS: Record<string, string> = {
  na: 'gray',
  deployed: 'green',
  done: 'blue',
  returned: 'purple',
  'not-needed': 'yellow',
  damaged: 'red',
}

/* ─── Types ─── */

type Member = {
  id: number
  role: string
  position: string | null
  location: string | null
  userId: number
  firstName: string
  lastName: string
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
  assignedMemberId: number | null
}

type AssignableMember = { id: number; name: string }

/* ─── Helpers ─── */

function isAssignable(category: string) {
  return ['panels', 'wireless_bp', 'hardwire_bp'].includes(category)
}

function getCategoryLabel(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label || value
}

function hasField(category: string, field: string) {
  const userFields = ['position', 'location', 'headsetType', 'ipAddress']
  const infraFields = ['location', 'ipAddress']
  if (['panels', 'wireless_bp', 'hardwire_bp'].includes(category)) return userFields.includes(field)
  if (['switches', 'antennas'].includes(category)) return infraFields.includes(field)
  return false
}

/* ─── Icons ─── */

function EditIcon() {
  return (
    <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
    </svg>
  )
}

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

/* ─── Main Component ─── */

export function ProjectPage({
  project,
  equipment,
  assignableMembers,
}: {
  project: Project
  equipment: EquipmentItem[]
  assignableMembers: AssignableMember[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Edit panel toggle
  const [showSettings, setShowSettings] = useState(false)

  // Project edit state
  const [name, setName] = useState(project.name)
  const [status, setStatus] = useState(project.status)
  const [managerId, setManagerId] = useState(
    () => project.members.find((m) => m.role === 'manager')?.userId.toString() || ''
  )
  const [editError, setEditError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Equipment state
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addCategory, setAddCategory] = useState('panels')
  const [addHardwareType, setAddHardwareType] = useState('')
  const [addQuantity, setAddQuantity] = useState(1)
  const [addError, setAddError] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<EquipmentItem>>({})

  /* ─── Project actions ─── */

  function handleSaveProject() {
    if (!name.trim()) {
      setEditError('Project name is required')
      return
    }
    setEditError('')
    startTransition(async () => {
      const formData = new FormData()
      formData.set('name', name.trim())
      formData.set('status', status)
      formData.set('managerId', managerId)
      const result = await updateProject(project.id, formData)
      if (result.error) {
        setEditError(result.error)
        return
      }
      showToast('success', 'Project updated')
      router.refresh()
    })
  }

  function handleDeleteProject() {
    startTransition(async () => {
      const result = await deleteProject(project.id)
      if (result.error) {
        showToast('error', result.error)
        return
      }
      router.push('/projects')
    })
  }

  /* ─── Equipment actions ─── */

  function handleBulkAdd() {
    if (addQuantity < 1) {
      setAddError('Quantity must be at least 1')
      return
    }
    setAddError('')
    startTransition(async () => {
      const result = await bulkCreateEquipment(project.id, addCategory, addHardwareType, addQuantity)
      if (result.error) {
        setAddError(result.error)
        return
      }
      showToast('success', `Added ${result.count} ${getCategoryLabel(addCategory)}`)
      setShowAdd(false)
      setAddHardwareType('')
      setAddQuantity(1)
      router.refresh()
    })
  }

  function startEdit(item: EquipmentItem) {
    setEditingId(item.id)
    setEditData({
      name: item.name,
      hardwareType: item.hardwareType || '',
      position: item.position || '',
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
        name: editData.name || item.name,
        hardwareType: (editData.hardwareType as string) || null,
        position: hasField(item.category, 'position') ? (editData.position as string) || null : null,
        location: hasField(item.category, 'location') ? (editData.location as string) || null : null,
        headsetType: hasField(item.category, 'headsetType') ? (editData.headsetType as string) || null : null,
        ipAddress: hasField(item.category, 'ipAddress') ? (editData.ipAddress as string) || null : null,
        deployStatus: (editData.deployStatus as string) || 'na',
        assignedToId: isAssignable(item.category) ? (editData.assignedToId as number | null) : null,
      })
      if (result.error) {
        showToast('error', result.error)
        return
      }
      setEditingId(null)
      router.refresh()
    })
  }

  function handleDeleteEquipment(item: EquipmentItem) {
    startTransition(async () => {
      const result = await deleteEquipment(project.id, item.id)
      if (result.error) {
        showToast('error', result.error)
        return
      }
      showToast('success', `${item.name} removed`)
      router.refresh()
    })
  }

  const filtered = equipment.filter((e) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      e.name.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q) ||
      getCategoryLabel(e.category).toLowerCase().includes(q) ||
      (e.hardwareType?.toLowerCase().includes(q) ?? false) ||
      (e.position?.toLowerCase().includes(q) ?? false) ||
      (e.location?.toLowerCase().includes(q) ?? false) ||
      (e.ipAddress?.toLowerCase().includes(q) ?? false) ||
      (e.assignedToName?.toLowerCase().includes(q) ?? false) ||
      e.deployStatus.toLowerCase().includes(q)
    )
  })

  return (
    <AppShell>
      <PageLayout
        title={project.name}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowSettings(!showSettings)}
            >
              <span className="flex items-center gap-1.5">
                <GearIcon />
                {showSettings ? 'Close' : 'Edit'}
              </span>
            </Button>
            <Button variant="secondary" onClick={() => router.push('/projects')}>
              Back
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* ─── Settings Panel (toggled by Edit button) ─── */}
          {showSettings && (
            <div className="space-y-4">
              {/* Project PIN Card */}
              <Card>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Project PIN</h3>
                    <p className="mt-1 text-xs text-gray-500">Share this PIN with your crew so they can join the project.</p>
                  </div>
                  <div className="flex gap-2">
                    {project.pin.split('').map((digit, i) => (
                      <span
                        key={i}
                        className="flex size-10 items-center justify-center rounded-lg bg-[#202020] text-lg font-bold text-[#0178a3]"
                      >
                        {digit}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>

              {/* Project Details Card */}
              <Card>
                <h3 className="text-sm font-semibold text-white">Project Details</h3>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <FormInput
                    label="Project name"
                    type="text"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setEditError('') }}
                    maxLength={100}
                  />
                  <FormSelect label="Manager" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                    <option value="">None</option>
                    {project.members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.firstName} {m.lastName}
                      </option>
                    ))}
                  </FormSelect>
                  <FormSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </FormSelect>
                </div>
                {editError && <p className="mt-3 text-sm text-red-400">{editError}</p>}
                <div className="mt-4 flex items-center justify-between">
                  <Button variant="danger" size="sm" onClick={() => setShowDeleteConfirm(true)} disabled={isPending}>
                    Delete Project
                  </Button>
                  <Button size="sm" onClick={handleSaveProject} disabled={isPending}>
                    {isPending ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </Card>

              {/* Divider */}
              <div className="border-t border-white/10" />
            </div>
          )}

          {/* ─── Equipment Distribution (always visible) ─── */}

          {/* Search + Add bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search equipment..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
              />
            </div>
            {!showAdd && <Button onClick={() => setShowAdd(true)}>Add Equipment</Button>}
          </div>

          {/* Bulk add form */}
          {showAdd && (
            <Card>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Add Equipment</h3>
                <IconButton onClick={() => { setShowAdd(false); setAddError('') }}>
                  <CloseIcon />
                </IconButton>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
                <FormSelect label="Category" value={addCategory} onChange={(e) => setAddCategory(e.target.value)}>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </FormSelect>
                <FormSelect label="Hardware type" value={addHardwareType} onChange={(e) => setAddHardwareType(e.target.value)}>
                  <option value="">None</option>
                  {(HARDWARE_TYPES[addCategory] || []).map((ht) => (
                    <option key={ht} value={ht}>{ht}</option>
                  ))}
                </FormSelect>
                <FormInput
                  label="Quantity"
                  type="number"
                  min={1}
                  max={200}
                  value={addQuantity}
                  onChange={(e) => setAddQuantity(parseInt(e.target.value) || 1)}
                />
                <div className="flex items-end">
                  <Button onClick={handleBulkAdd} disabled={isPending} className="w-full">
                    {isPending ? 'Adding...' : 'Add'}
                  </Button>
                </div>
              </div>
              {addError && <p className="mt-3 text-sm text-red-400">{addError}</p>}
            </Card>
          )}

          {/* Equipment count */}
          <p className="text-xs text-gray-500">
            {filtered.length} of {equipment.length} items
            {search && ` matching "${search}"`}
          </p>

          {/* Equipment list */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={<WrenchIcon />}
              title={search ? 'No matches found' : 'No equipment yet'}
              message={search ? 'Try a different search term.' : 'Add equipment using the button above.'}
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((item) => {
                const isEditing = editingId === item.id
                const categoryInfo = CATEGORIES.find((c) => c.value === item.category)

                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-4 rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-colors hover:bg-[#313131]"
                  >
                    {/* Status badge */}
                    <div className="shrink-0 pt-0.5">
                      {isEditing ? (
                        <select
                          value={(editData.deployStatus as string) || 'na'}
                          onChange={(e) => setEditData({ ...editData, deployStatus: e.target.value })}
                          className="appearance-none rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white outline-none"
                        >
                          {DEPLOY_STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge
                          label={DEPLOY_STATUSES.find((s) => s.value === item.deployStatus)?.label || 'N/A'}
                          color={STATUS_COLORS[item.deployStatus] || 'gray'}
                        />
                      )}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <FormInput compact label="Name" type="text" value={(editData.name as string) || ''} onChange={(e) => setEditData({ ...editData, name: e.target.value })} />
                          <FormSelect compact label="Hardware" value={(editData.hardwareType as string) || ''} onChange={(e) => setEditData({ ...editData, hardwareType: e.target.value })}>
                            <option value="">None</option>
                            {(HARDWARE_TYPES[item.category] || []).map((ht) => (
                              <option key={ht} value={ht}>{ht}</option>
                            ))}
                          </FormSelect>
                          {hasField(item.category, 'position') && (
                            <FormInput compact label="Position" type="text" value={(editData.position as string) || ''} onChange={(e) => setEditData({ ...editData, position: e.target.value })} />
                          )}
                          {hasField(item.category, 'location') && (
                            <FormInput compact label="Location" type="text" value={(editData.location as string) || ''} onChange={(e) => setEditData({ ...editData, location: e.target.value })} />
                          )}
                          {hasField(item.category, 'headsetType') && (
                            <FormInput compact label="Headset" type="text" value={(editData.headsetType as string) || ''} onChange={(e) => setEditData({ ...editData, headsetType: e.target.value })} />
                          )}
                          {hasField(item.category, 'ipAddress') && (
                            <FormInput compact label="IP Address" type="text" value={(editData.ipAddress as string) || ''} onChange={(e) => setEditData({ ...editData, ipAddress: e.target.value })} />
                          )}
                          {isAssignable(item.category) && (
                            <FormSelect compact label="Assigned to" value={(editData.assignedToId as number) || ''} onChange={(e) => setEditData({ ...editData, assignedToId: e.target.value ? parseInt(e.target.value) : null })}>
                              <option value="">Unassigned</option>
                              {assignableMembers.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </FormSelect>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">{item.name}</span>
                            <span className="text-xs text-gray-500">{categoryInfo?.label}</span>
                            {item.hardwareType && (
                              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
                                {item.hardwareType}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                            {item.position && <span>Pos: {item.position}</span>}
                            {item.location && <span>Loc: {item.location}</span>}
                            {item.headsetType && <span>HS: {item.headsetType}</span>}
                            {item.ipAddress && <span>IP: {item.ipAddress}</span>}
                            {item.assignedToName && (
                              <span className="text-[#0178a3]">{item.assignedToName}</span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button size="sm" onClick={() => handleSaveEquipment(item)} disabled={isPending}>Save</Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditingId(null)} disabled={isPending}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <IconButton onClick={() => startEdit(item)}>
                            <EditIcon />
                          </IconButton>
                          <IconButton variant="danger" onClick={() => handleDeleteEquipment(item)} disabled={isPending}>
                            <CloseIcon className="size-4" />
                          </IconButton>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </PageLayout>

      <Modal
        open={showDeleteConfirm}
        title="Delete Project"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteProject} disabled={isPending}>
              {isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        Are you sure you want to delete <span className="text-white font-medium">{project.name}</span>? This will remove all members and cannot be undone.
      </Modal>
    </AppShell>
  )
}
