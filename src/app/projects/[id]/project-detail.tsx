'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/button'
import { ToastContainer, showToast } from '@/components/toast'
import { AppShell } from '@/components/app-shell'
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

  // Project edit state
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
      <div className="py-10">
        <PageHeader
          title={project.name}
          action={
            <Button variant="secondary" onClick={() => router.push('/projects')}>
              Back to Projects
            </Button>
          }
        />

        <main>
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">

            {/* Project PIN Card */}
            <div className="rounded-2xl bg-[#2a2a2a] p-5">
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
            </div>

            {/* Project Details Card */}
            <div className="rounded-2xl bg-[#2a2a2a] p-5">
              <h3 className="text-sm font-semibold text-white">Project Details</h3>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="project-name" className="block text-xs font-medium text-gray-400">
                    Project name
                  </label>
                  <input
                    id="project-name"
                    type="text"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setEditError('') }}
                    maxLength={100}
                    className="mt-1 w-full rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[#0178a3]"
                  />
                </div>
                <div>
                  <label htmlFor="manager" className="block text-xs font-medium text-gray-400">
                    Manager
                  </label>
                  <select
                    id="manager"
                    value={managerId}
                    onChange={(e) => setManagerId(e.target.value)}
                    className="mt-1 w-full appearance-none rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[#0178a3]"
                  >
                    <option value="">None</option>
                    {project.members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.firstName} {m.lastName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="status" className="block text-xs font-medium text-gray-400">
                    Status
                  </label>
                  <select
                    id="status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="mt-1 w-full appearance-none rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[#0178a3]"
                  >
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>

              {editError && (
                <p className="mt-3 text-sm text-red-400">{editError}</p>
              )}

              <div className="mt-4 flex items-center justify-between">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isPending}
                >
                  Delete Project
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isPending}>
                  {isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>

            {/* Members Card */}
            <div className="rounded-2xl bg-[#2a2a2a] p-5">
              <h3 className="text-sm font-semibold text-white">
                Members ({project.members.length})
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Team members join by entering the project PIN on the login page.
              </p>

              <div className="mt-4 space-y-2">
                {project.members.length === 0 ? (
                  <p className="text-sm text-gray-500">No members yet. Share the project PIN to get started.</p>
                ) : (
                  project.members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-3 rounded-xl bg-[#202020] px-4 py-3"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0178a3] text-xs font-medium text-white">
                        {member.firstName[0]}{member.lastName[0]}
                      </span>
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
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member)}
                          disabled={isPending}
                          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/10 hover:text-red-400 disabled:opacity-50"
                        >
                          <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-2xl bg-[#2a2a2a] p-6">
            <h3 className="text-lg font-semibold text-white">Delete Project</h3>
            <p className="mt-2 text-sm text-gray-400">
              Are you sure you want to delete <span className="text-white font-medium">{project.name}</span>? This will remove all members and cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleDelete} disabled={isPending}>
                {isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
    </AppShell>
  )
}
