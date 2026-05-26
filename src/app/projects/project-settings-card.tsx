'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/card'
import { FormInput } from '@/components/form-field'
import { SearchableSelect } from '@/components/searchable-select'
import { Modal } from '@/components/modal'
import { showToast } from '@/components/toast'
import { updateProject, deleteProject, setReturnPhase } from './[id]/actions'

/**
 * The project-edit settings card. Used to live on the Comms page
 * (project details) and is now lifted onto the Projects-list rows —
 * each row gets an Edit button that expands an instance of this card
 * inline. Self-contained state and action wiring so a parent only
 * needs to mount it once per row.
 */
type SettingsMember = {
  id: number
  userId: number
  firstName: string
  lastName: string
  role: string
}

export function ProjectSettingsCard({
  project,
  members,
  isProjectAdmin,
  onClose,
  onDeleted,
}: {
  project: {
    id: number
    name: string
    pin: string
    status: string
    returnPhaseActive: boolean
  }
  members: SettingsMember[]
  /** Admin-only affordances (archive/delete) gate on this. Managers
   *  can edit name + manager + return-phase but can't archive or
   *  delete the project itself. */
  isProjectAdmin: boolean
  /** Called when the user taps the close X — parent collapses the row. */
  onClose: () => void
  /** Called after a successful delete so the parent can refresh /
   *  collapse + drop the row from the list. */
  onDeleted?: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState(project.name)
  const [status, setStatus] = useState(project.status)
  const [managerId, setManagerId] = useState(
    () => members.find((m) => m.role === 'manager')?.userId.toString() || '',
  )
  const [editError, setEditError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // Optimistic state for the Activate Return / Undo Return toggle so
  // the button label flips instantly without waiting for a refresh.
  const [returnPhaseActive, setReturnPhaseActiveLocal] = useState(project.returnPhaseActive)
  const [returnPending, setReturnPending] = useState(false)

  function handleSave() {
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

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteProject(project.id)
      if (result.error) {
        showToast('error', result.error)
        return
      }
      showToast('success', 'Project deleted')
      setShowDeleteConfirm(false)
      onDeleted?.()
      router.refresh()
    })
  }

  function handleToggleReturnPhase() {
    const next = !returnPhaseActive
    setReturnPhaseActiveLocal(next)
    setReturnPending(true)
    startTransition(async () => {
      const res = await setReturnPhase(project.id, next)
      setReturnPending(false)
      if (res.error) {
        setReturnPhaseActiveLocal(!next)
        showToast('error', res.error)
        return
      }
      showToast('success', next ? 'Return phase activated' : 'Return phase ended')
      router.refresh()
    })
  }

  return (
    <>
      <Card>
        {/* Form fields — PIN moved out to the collapsed project row
            on the list (rendered next to the project name on the
            same row), so the settings card just carries the
            editable fields now. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput
            label="Project name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setEditError('')
            }}
            maxLength={100}
          />
          <SearchableSelect
            label="Manager"
            value={managerId}
            placeholder="None"
            options={[
              { value: '', label: 'None' },
              ...members.map((m) => ({
                value: String(m.userId),
                label: `${m.firstName} ${m.lastName}`,
              })),
            ]}
            onChange={(v) => setManagerId(v)}
          />
        </div>
        {editError && <p className="mt-3 text-sm text-red-400">{editError}</p>}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-2">
          {isProjectAdmin && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isPending}
              className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              Delete
            </button>
          )}
          {isProjectAdmin && (
            <button
              type="button"
              onClick={() => setStatus(status === 'archived' ? 'active' : 'archived')}
              disabled={isPending}
              className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {status === 'archived' ? 'Restore' : 'Archive'}
            </button>
          )}
          <button
            type="button"
            onClick={handleToggleReturnPhase}
            disabled={returnPending}
            className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {returnPending ? '...' : returnPhaseActive ? 'Undo Return' : 'Activate Return'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="w-full rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </Card>

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
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? 'Deleting...' : 'Delete'}
            </button>
          </>
        }
      >
        Are you sure you want to delete{' '}
        <span className="text-white font-medium">{project.name}</span>? This will
        remove all members and cannot be undone.
      </Modal>
    </>
  )
}
