'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/button'
import { showToast } from '@/components/toast'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'
import { Card } from '@/components/card'
import { RowCard } from '@/components/row-card'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { IconButton } from '@/components/icon-button'
import { FormInput } from '@/components/form-field'
import { createProject } from './actions'
import { setProjectStatus } from './[id]/actions'

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

function FolderIcon() {
  return (
    <svg className="size-12 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  )
}

export function ProjectsContent({ projects, userName, isAdmin, isUserOnly, showMyEquipment }: { projects: Project[]; userName?: string; isAdmin?: boolean; isUserOnly?: boolean; showMyEquipment?: boolean }) {
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const filteredProjects = projects
    .filter((p) => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      const creatorName = `${p.createdBy.firstName} ${p.createdBy.lastName}`.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        creatorName.includes(q) ||
        p.status.toLowerCase().includes(q)
      )
    })
    // Active first, archived after — preserve createdAt desc within each bucket
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'archived' ? 1 : -1
      return 0
    })

  function handleRestore(projectId: number) {
    startTransition(async () => {
      const result = await setProjectStatus(projectId, 'active')
      if (result.error) { showToast('error', result.error); return }
      showToast('success', 'Project restored')
      router.refresh()
    })
  }

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
    <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} showMyEquipment={showMyEquipment}>
      <PageLayout
        title="Projects"
        titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
        inlineAction
        action={!showForm ? (
          <Button onClick={() => setShowForm(true)}>
            <span className="sm:hidden">+</span>
            <span className="hidden sm:inline">New Project</span>
          </Button>
        ) : undefined}
      >
        {/* Inline create form */}
        {showForm && (
          <Card className="mb-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">New Project</h3>
              <IconButton onClick={closeForm}>
                <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </IconButton>
            </div>
            <form action={handleSubmit}>
              <div className="mt-4">
                <FormInput
                  label="Project name"
                  id="name"
                  name="name"
                  type="text"
                  placeholder="e.g. Grammy Awards 2026"
                  maxLength={100}
                  autoFocus
                  onChange={() => setError('')}
                />
              </div>
              {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={closeForm} disabled={isPending}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? 'Saving...' : 'Save Project'}
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Search bar */}
        {projects.length > 0 && (
          <div className="sticky top-16 z-20 -mx-4 bg-[#202020] px-4 pb-3 pt-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-2.5 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
            />
          </div>
        )}

        {/* Project list */}
        {projects.length === 0 && !showForm ? (
          <EmptyState
            icon={<FolderIcon />}
            title="No projects yet"
            message="Create your first project to get started."
          />
        ) : filteredProjects.length === 0 ? (
          <EmptyState
            icon={<FolderIcon />}
            title="No matches found"
            message="Try a different search term."
          />
        ) : (
          <div className="space-y-2">
            {filteredProjects.map((project) => {
              const isArchived = project.status === 'archived'
              return (
                <RowCard
                  key={project.id}
                  className={isArchived ? 'opacity-60' : ''}
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${isArchived ? 'bg-gray-500/15' : 'bg-[#0178a3]/15'}`}>
                    <svg className={`size-5 ${isArchived ? 'text-gray-500' : 'text-[#0178a3]'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${isArchived ? 'text-gray-400' : 'text-white'}`}>{project.name}</span>
                      <StatusBadge label={project.status} color={isArchived ? 'gray' : 'green'} />
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      <span>{project.memberCount} members</span>
                      <span>·</span>
                      <span>{project.equipmentCount} equipment</span>
                      <span>·</span>
                      <span>{formatDate(project.createdAt)}</span>
                    </div>
                  </div>
                  {isArchived && isAdmin && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRestore(project.id)
                      }}
                    >
                      Restore
                    </Button>
                  )}
                </RowCard>
              )
            })}
          </div>
        )}
      </PageLayout>
    </AppShell>
  )
}
