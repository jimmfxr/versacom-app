'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/button'
import { ToastContainer, showToast } from '@/components/toast'
import { AppShell } from '@/components/app-shell'
import { bulkCreateEquipment, updateEquipment, deleteEquipment } from './actions'

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
  na: 'bg-gray-500/15 text-gray-400',
  deployed: 'bg-green-500/15 text-green-400',
  done: 'bg-blue-500/15 text-blue-400',
  returned: 'bg-purple-500/15 text-purple-400',
  'not-needed': 'bg-yellow-500/15 text-yellow-400',
  damaged: 'bg-red-500/15 text-red-400',
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

type Member = { id: number; name: string }

function isAssignable(category: string) {
  return ['panels', 'wireless_bp', 'hardwire_bp'].includes(category)
}

function getCategoryLabel(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label || value
}

// Fields shown for user-assigned equipment (panels, wlbp, hwbp)
function hasField(category: string, field: string) {
  const userFields = ['position', 'location', 'headsetType', 'ipAddress']
  const infraFields = ['location', 'ipAddress']
  const audioFields: string[] = []

  if (['panels', 'wireless_bp', 'hardwire_bp'].includes(category)) return userFields.includes(field)
  if (['switches', 'antennas'].includes(category)) return infraFields.includes(field)
  if (category === 'audio') return audioFields.includes(field)
  return false
}

export function DistributionContent({
  project,
  equipment,
  members,
}: {
  project: { id: number; name: string; status: string }
  equipment: EquipmentItem[]
  members: Member[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Search
  const [search, setSearch] = useState('')

  // Bulk add form
  const [showAdd, setShowAdd] = useState(false)
  const [addCategory, setAddCategory] = useState('panels')
  const [addHardwareType, setAddHardwareType] = useState('')
  const [addQuantity, setAddQuantity] = useState(1)
  const [addError, setAddError] = useState('')

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<EquipmentItem>>({})

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

  function handleSaveEdit(item: EquipmentItem) {
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

  function handleDelete(item: EquipmentItem) {
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

  // Filter equipment by search
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
      <div className="py-10">
        <PageHeader
          title={`${project.name} — Distribution`}
          action={
            <Button variant="secondary" onClick={() => router.push(`/projects/${project.id}`)}>
              Back to Project
            </Button>
          }
        />
        <main>
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-4">

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
              {!showAdd && (
                <Button onClick={() => setShowAdd(true)}>Add Equipment</Button>
              )}
            </div>

            {/* Bulk add form */}
            {showAdd && (
              <div className="rounded-2xl bg-[#2a2a2a] p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Add Equipment</h3>
                  <button
                    type="button"
                    onClick={() => { setShowAdd(false); setAddError('') }}
                    className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-400">Category</label>
                    <select
                      value={addCategory}
                      onChange={(e) => setAddCategory(e.target.value)}
                      className="mt-1 w-full appearance-none rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[#0178a3]"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400">Hardware type</label>
                    <select
                      value={addHardwareType}
                      onChange={(e) => setAddHardwareType(e.target.value)}
                      className="mt-1 w-full appearance-none rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[#0178a3]"
                    >
                      <option value="">None</option>
                      {(HARDWARE_TYPES[addCategory] || []).map((ht) => (
                        <option key={ht} value={ht}>{ht}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400">Quantity</label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={addQuantity}
                      onChange={(e) => setAddQuantity(parseInt(e.target.value) || 1)}
                      className="mt-1 w-full rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[#0178a3]"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={handleBulkAdd} disabled={isPending} className="w-full">
                      {isPending ? 'Adding...' : 'Add'}
                    </Button>
                  </div>
                </div>
                {addError && <p className="mt-3 text-sm text-red-400">{addError}</p>}
              </div>
            )}

            {/* Equipment count */}
            <p className="text-xs text-gray-500">
              {filtered.length} of {equipment.length} items
              {search && ` matching "${search}"`}
            </p>

            {/* Equipment list */}
            {filtered.length === 0 ? (
              <div className="rounded-2xl bg-[#2a2a2a] p-12 text-center">
                <svg className="mx-auto size-12 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
                </svg>
                <p className="mt-4 text-base font-medium text-white">
                  {search ? 'No matches found' : 'No equipment yet'}
                </p>
                <p className="mt-1 text-sm text-gray-400">
                  {search ? 'Try a different search term.' : 'Add equipment using the button above.'}
                </p>
              </div>
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
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[item.deployStatus] || STATUS_COLORS.na}`}>
                            {DEPLOY_STATUSES.find((s) => s.value === item.deployStatus)?.label || 'N/A'}
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div>
                              <label className="block text-[10px] font-medium text-gray-500">Name</label>
                              <input
                                type="text"
                                value={(editData.name as string) || ''}
                                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                                className="mt-0.5 w-full rounded border border-white/10 bg-[#202020] px-2 py-1 text-xs text-white outline-none focus:border-[#0178a3]"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-gray-500">Hardware</label>
                              <select
                                value={(editData.hardwareType as string) || ''}
                                onChange={(e) => setEditData({ ...editData, hardwareType: e.target.value })}
                                className="mt-0.5 w-full appearance-none rounded border border-white/10 bg-[#202020] px-2 py-1 text-xs text-white outline-none focus:border-[#0178a3]"
                              >
                                <option value="">None</option>
                                {(HARDWARE_TYPES[item.category] || []).map((ht) => (
                                  <option key={ht} value={ht}>{ht}</option>
                                ))}
                              </select>
                            </div>
                            {hasField(item.category, 'position') && (
                              <div>
                                <label className="block text-[10px] font-medium text-gray-500">Position</label>
                                <input
                                  type="text"
                                  value={(editData.position as string) || ''}
                                  onChange={(e) => setEditData({ ...editData, position: e.target.value })}
                                  className="mt-0.5 w-full rounded border border-white/10 bg-[#202020] px-2 py-1 text-xs text-white outline-none focus:border-[#0178a3]"
                                />
                              </div>
                            )}
                            {hasField(item.category, 'location') && (
                              <div>
                                <label className="block text-[10px] font-medium text-gray-500">Location</label>
                                <input
                                  type="text"
                                  value={(editData.location as string) || ''}
                                  onChange={(e) => setEditData({ ...editData, location: e.target.value })}
                                  className="mt-0.5 w-full rounded border border-white/10 bg-[#202020] px-2 py-1 text-xs text-white outline-none focus:border-[#0178a3]"
                                />
                              </div>
                            )}
                            {hasField(item.category, 'headsetType') && (
                              <div>
                                <label className="block text-[10px] font-medium text-gray-500">Headset</label>
                                <input
                                  type="text"
                                  value={(editData.headsetType as string) || ''}
                                  onChange={(e) => setEditData({ ...editData, headsetType: e.target.value })}
                                  className="mt-0.5 w-full rounded border border-white/10 bg-[#202020] px-2 py-1 text-xs text-white outline-none focus:border-[#0178a3]"
                                />
                              </div>
                            )}
                            {hasField(item.category, 'ipAddress') && (
                              <div>
                                <label className="block text-[10px] font-medium text-gray-500">IP Address</label>
                                <input
                                  type="text"
                                  value={(editData.ipAddress as string) || ''}
                                  onChange={(e) => setEditData({ ...editData, ipAddress: e.target.value })}
                                  className="mt-0.5 w-full rounded border border-white/10 bg-[#202020] px-2 py-1 text-xs text-white outline-none focus:border-[#0178a3]"
                                />
                              </div>
                            )}
                            {isAssignable(item.category) && (
                              <div>
                                <label className="block text-[10px] font-medium text-gray-500">Assigned to</label>
                                <select
                                  value={(editData.assignedToId as number) || ''}
                                  onChange={(e) => setEditData({ ...editData, assignedToId: e.target.value ? parseInt(e.target.value) : null })}
                                  className="mt-0.5 w-full appearance-none rounded border border-white/10 bg-[#202020] px-2 py-1 text-xs text-white outline-none focus:border-[#0178a3]"
                                >
                                  <option value="">Unassigned</option>
                                  {members.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                  ))}
                                </select>
                              </div>
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
                            <Button size="sm" onClick={() => handleSaveEdit(item)} disabled={isPending}>
                              Save
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setEditingId(null)} disabled={isPending}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(item)}
                              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/10 hover:text-white"
                            >
                              <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(item)}
                              disabled={isPending}
                              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/10 hover:text-red-400 disabled:opacity-50"
                            >
                              <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>
      <ToastContainer />
    </AppShell>
  )
}
