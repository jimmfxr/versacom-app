'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/button'
import { showToast } from '@/components/toast'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'
import { Card } from '@/components/card'
import { Avatar } from '@/components/avatar'
import { IconButton } from '@/components/icon-button'
import { Modal } from '@/components/modal'
import { FormInput, FormSelect } from '@/components/form-field'
import { updateProject, removeMember, deleteProject } from './actions'

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

export function ProjectDetail({ project }: { project: Project }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState(project.name)
  const [status, setStatus] = useState(project.status)
  const [managerId, setManagerId] = useState(
    () => project.members.find((m) => m.role === 'manager')?.userId.toString() || ''
  )
  const [editError, setEditError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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

  function handleRemoveMember(member: Member) {
    startTransition(async () => {
      const result = await removeMember(project.id, member.id)
      if (result.error) {
        showToast('error', result.error)
        return
      }
      showToast('success', `${member.firstName} ${member.lastName} removed`)
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
      router.push('/projects')
    })
  }

  return (
    <AppShell>
      <PageLayout
        title={project.name}
        action={
          <Button variant="secondary" onClick={() => router.push('/projects')}>
            Back to Projects
          </Button>
        }
      >
        <div className="space-y-6">
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
                id="project-name"
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setEditError('') }}
                maxLength={100}
              />
              <FormSelect label="Manager" id="manager" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">None</option>
                {project.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.firstName} {m.lastName}
                  </option>
                ))}
              </FormSelect>
              <FormSelect label="Status" id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </FormSelect>
            </div>
            {editError && <p className="mt-3 text-sm text-red-400">{editError}</p>}
            <div className="mt-4 flex items-center justify-between">
              <Button variant="danger" size="sm" onClick={() => setShowDeleteConfirm(true)} disabled={isPending}>
                Delete Project
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isPending}>
                {isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </Card>

          {/* Members Card */}
          <Card>
            <h3 className="text-sm font-semibold text-white">Members ({project.members.length})</h3>
            <p className="mt-1 text-xs text-gray-500">
              Team members join by entering the project PIN on the login page.
            </p>
            <div className="mt-4 space-y-2">
              {project.members.length === 0 ? (
                <p className="text-sm text-gray-500">No members yet. Share the project PIN to get started.</p>
              ) : (
                project.members.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 rounded-xl bg-[#202020] px-4 py-3">
                    <Avatar name={`${member.firstName} ${member.lastName}`} />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-white">
                        {member.firstName} {member.lastName}
                      </span>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <span className="capitalize">{member.role}</span>
                        {member.position && (
                          <>
                            <span>·</span>
                            <span>{member.position}</span>
                          </>
                        )}
                        {member.location && (
                          <>
                            <span>·</span>
                            <span>{member.location}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {member.userId !== project.createdBy.id && (
                      <IconButton variant="danger" onClick={() => handleRemoveMember(member)} disabled={isPending}>
                        <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </IconButton>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>
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
            <Button variant="danger" onClick={handleDelete} disabled={isPending}>
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
