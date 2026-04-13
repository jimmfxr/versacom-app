'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/button'
import { ToastContainer, showToast } from '@/components/toast'
import { AppShell } from '@/components/app-shell'
import { createProject } from './actions'

type Project = {
  id: number
  name: string
  status: string
  createdAt: string
  createdBy: { firstName: string; lastName: string }
  memberCount: number
  equipmentCount: number
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function ProjectsContent({ projects }: { projects: Project[] }) {
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function closeForm() {
    setShowForm(false)
    setError('')
  }

  async function handleSubmit(formData: FormData) {
    const name = (formData.get('name') as string)?.trim()
    if (!name) {
      setError('Project name is required')
      return
    }
    if (name.length > 100) {
      setError('Project name must be 100 characters or less')
      return
    }

    setError('')
    startTransition(async () => {
      const result = await createProject(formData)
      if (result.error) {
        setError(result.error)
        return
      }
      showToast('success', `${result.name} created`)
      closeForm()
      router.refresh()
    })
  }

  return (
    <AppShell>
      <div className="py-10">
        <PageHeader
          title="Projects"
          action={
            !showForm ? (
              <Button onClick={() => setShowForm(true)}>New Project</Button>
            ) : undefined
          }
        />
        <main>
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

            {/* Inline create form */}
            {showForm && (
              <div className="mb-4 rounded-2xl bg-[#2a2a2a] p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">New Project</h3>
                  <button
                    type="button"
                    onClick={closeForm}
                    className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form action={handleSubmit}>
                  <div className="mt-4">
                    <label htmlFor="name" className="block text-xs font-medium text-gray-400">
                      Project name
                    </label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      placeholder="e.g. Grammy Awards 2026"
                      maxLength={100}
                      autoFocus
                      onChange={() => setError('')}
                      className="mt-1 w-full rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
                    />
                  </div>

                  {error && (
                    <p className="mt-3 text-sm text-red-400">{error}</p>
                  )}

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={closeForm} disabled={isPending}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={isPending}>
                      {isPending ? 'Saving...' : 'Save Project'}
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* Project list */}
            {projects.length === 0 && !showForm ? (
              <div className="rounded-2xl bg-[#2a2a2a] p-12 text-center">
                <svg className="mx-auto size-12 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                </svg>
                <p className="mt-4 text-base font-medium text-white">No projects yet</p>
                <p className="mt-1 text-sm text-gray-400">Create your first project to get started.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    onClick={() => router.push(`/projects/${project.id}`)}
                    className="flex cursor-pointer items-center gap-4 rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-colors hover:bg-[#313131]"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#0178a3]/15">
                      <svg className="size-5 text-[#0178a3]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                      </svg>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">
                          {project.name}
                        </span>
                        <span className="inline-flex rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-400">
                          {project.status}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                        <span>{project.memberCount} members</span>
                        <span>·</span>
                        <span>{project.equipmentCount} equipment</span>
                        <span>·</span>
                        <span>{formatDate(project.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
      <ToastContainer />
    </AppShell>
  )
}
