'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/button'
import { showToast } from '@/components/toast'
import { PageLayout } from '@/components/page-layout'
import { Card } from '@/components/card'
import { RowCard } from '@/components/row-card'
import { EmptyState } from '@/components/empty-state'
import { IconButton } from '@/components/icon-button'
import { FormInput } from '@/components/form-field'
import { createProject, cloneProject } from './actions'
import { setProjectStatus } from './[id]/actions'
import { ProjectSettingsCard } from './project-settings-card'

type Project = {
  id: number
  name: string
  pin: string
  status: string
  returnPhaseActive: boolean
  createdAt: string
  createdBy: { firstName: string; lastName: string }
  memberCount: number
  equipmentCount: number
  /** True when the viewer is admin on THIS project (or a global admin
   *  on any project). Gates the Archive / Delete affordances on the
   *  expanded settings card. */
  isProjectAdmin: boolean
  members: Array<{
    id: number
    userId: number
    firstName: string
    lastName: string
    role: string
  }>
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Tiny iOS-style toggle switch. Track is gray when off, green when
// on. Knob slides left ↔ right. Used inline in the Clone form
// alongside per-category labels. Plain <button> so keyboard users
// can space-bar toggle.
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
        checked ? 'bg-green-500' : 'bg-white/15'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
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
  // Clone-mode toggles inside the New Project card. When `cloneOpen`
  // is true, the form switches from the simple name input to the
  // clone form: source picker + 4 toggle switches + new name. The
  // toggles default to ON so a user just hits Save and gets a full
  // copy. Each can be flipped off independently.
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloneSourceId, setCloneSourceId] = useState<number | null>(null)
  const [cloneTeam, setCloneTeam] = useState(true)
  const [cloneEquipment, setCloneEquipment] = useState(true)
  const [clonePickList, setClonePickList] = useState(true)
  const [cloneInventory, setCloneInventory] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  // Which project row is currently expanded into its settings card.
  // Only one at a time — clicking Edit on a different row collapses
  // the previous one.
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null)
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
    setCloneOpen(false)
    setCloneSourceId(null)
    setError('')
  }

  // Submit handler for the Clone form. Mirrors handleSubmit but calls
  // the cloneProject action with the source + 4 toggle flags.
  async function handleCloneSubmit(formData: FormData) {
    if (cloneSourceId == null) {
      setError('Pick a project to clone from')
      return
    }
    const name = (formData.get('name') as string)?.trim()
    if (!name) { setError('New project name is required'); return }
    if (name.length > 100) { setError('Name must be 100 characters or less'); return }
    setError('')
    formData.set('sourceId', String(cloneSourceId))
    formData.set('team', cloneTeam ? '1' : '0')
    formData.set('equipment', cloneEquipment ? '1' : '0')
    formData.set('pickList', clonePickList ? '1' : '0')
    formData.set('inventory', cloneInventory ? '1' : '0')
    startTransition(async () => {
      const result = await cloneProject(formData)
      if (result.error) { setError(result.error); return }
      showToast('success', `${result.name} cloned`)
      closeForm()
      router.refresh()
    })
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
      <PageLayout
        title="Projects"
        titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
        inlineAction
        stickyHeader
        bottomBorder
        action={
          <div className="flex items-center gap-3">
            {/* Desktop-only inline search bar — stays visible whether
                or not the create form is open. Hiding it when the
                form opens used to make the header reflow and looked
                like the search "disappeared". Now the only thing
                that toggles is the + button. */}
            {projects.length > 0 && (
              <input
                type="text"
                placeholder="Search projects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="hidden w-64 rounded-lg border border-white/10 px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white focus:border-[#0178a3] sm:block"
              />
            )}
            {!showForm && (
              <Button onClick={() => setShowForm(true)} aria-label="New Project">+</Button>
            )}
          </div>
        }
      >
        {/* Inline create form. Two modes:
              - default (cloneOpen=false): single name input, classic
                "create blank project" flow.
              - clone (cloneOpen=true): adds a source picker + four
                toggle switches above the name, calling cloneProject
                instead of createProject on submit. The "Clone from
                existing" button toggles between the two. */}
        {showForm && (
          <Card className="mb-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                {cloneOpen ? 'Clone Project' : 'New Project'}
              </h3>
              <IconButton onClick={closeForm}>
                <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </IconButton>
            </div>
            <form action={cloneOpen ? handleCloneSubmit : handleSubmit}>
              {cloneOpen && (
                <div className="mt-4 flex flex-col gap-4">
                  {/* Source project picker — only projects the user
                      can read appear in the parent's `projects` prop,
                      so that's the canonical list. Archived projects
                      are still cloneable (sometimes useful for
                      revisiting a tour stop config). */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="sourceId" className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Source project
                    </label>
                    <select
                      id="sourceId"
                      value={cloneSourceId ?? ''}
                      onChange={(e) => {
                        setCloneSourceId(e.target.value ? parseInt(e.target.value, 10) : null)
                        setError('')
                      }}
                      className="w-full rounded-lg border border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
                    >
                      <option value="">Select a project…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.status === 'archived' ? ' (archived)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Toggle switches — left label, right switch. */}
                  <div className="flex flex-col gap-3">
                    {([
                      { label: 'Team members', checked: cloneTeam, onChange: setCloneTeam, hint: 'Crew + roles + positions' },
                      { label: 'Equipment list', checked: cloneEquipment, onChange: setCloneEquipment, hint: 'Gear list (unassigned, deploy reset)' },
                      { label: 'Pick list', checked: clonePickList, onChange: setClonePickList, hint: 'CONF / IFB / Audio_IO / GRP items' },
                      { label: 'Inventory totals', checked: cloneInventory, onChange: setCloneInventory, hint: 'Headsets + panel misc brought-to-show counts' },
                    ] as const).map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-gray-200">{row.label}</div>
                          <div className="text-[11px] text-gray-500">{row.hint}</div>
                        </div>
                        <Switch checked={row.checked} onChange={row.onChange} label={row.label} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4">
                <FormInput
                  label={cloneOpen ? 'New project name' : 'Project name'}
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
              {/* Action row — all three buttons right-aligned. Clone
                  and Cancel share the chip-inactive style (transparent
                  fill + thin border) used elsewhere for Edit / Back
                  buttons; Save is the cyan primary. Clone sits to the
                  left of Cancel. */}
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setCloneOpen((v) => !v); setError('') }}
                  disabled={isPending}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:opacity-50"
                >
                  {cloneOpen ? 'New project' : 'Clone'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={isPending}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:opacity-50"
                >
                  Cancel
                </button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending
                    ? (cloneOpen ? 'Cloning…' : 'Saving…')
                    : (cloneOpen ? 'Clone Project' : 'Save')}
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Mobile-only sticky search bar. On desktop the search lives
            inline in the page header (left of the New Project button)
            so we hide this row at sm+. */}
        {projects.length > 0 && (
          <div className="sticky top-16 z-20 -mx-4 bg-[#202020] px-4 pb-3 sm:hidden">
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-white/10 px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white focus:border-[#0178a3]"
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
          // Scrollable region (desktop): card list scrolls inside this
          // div while the search bar above stays put.
          <div data-scroll-container className="divide-y divide-white/[0.06] sm:flex-1 sm:overflow-y-auto sm:overscroll-none sm:pt-1 sm:pb-20">
            {filteredProjects.map((project) => {
              const isArchived = project.status === 'archived'
              const isEditing = editingProjectId === project.id
              const canEdit = isAdmin || project.members.some(
                (m) => (m.role === 'admin' || m.role === 'manager'),
              )
              return (
                <div key={project.id}>
                  <RowCard
                    className={isArchived ? 'opacity-60' : ''}
                  >
                    <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${isArchived ? 'bg-gray-500/15' : 'bg-[#0178a3]/15'}`}>
                      <svg className={`size-5 ${isArchived ? 'text-gray-500' : 'text-[#0178a3]'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${isArchived ? 'text-gray-400' : 'text-white'}`}>{project.name}</span>
                        <span className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-200 ${isArchived ? 'border-white/10' : 'border-green-400/60'}`}>
                          {project.status}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
                        <span>{project.memberCount} members</span>
                        <span>·</span>
                        <span>{project.equipmentCount} equipment</span>
                        <span>·</span>
                        <span suppressHydrationWarning>{formatDate(project.createdAt)}</span>
                        <span>·</span>
                        <span>by <span className="text-[#22a7d3]">{project.createdBy.firstName} {project.createdBy.lastName}</span></span>
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
                    {/* Edit button on the far right — opens the
                        inline settings card below the row. Stop
                        propagation so the click doesn't also fire
                        the row's navigate-to-Comms handler. Only
                        admin/manager-on-this-project can edit. */}
                    {canEdit && !isEditing && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingProjectId(project.id)
                        }}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
                      >
                        Edit
                      </button>
                    )}
                  </RowCard>

                  {/* Inline settings card — expanded when the row's
                      Edit button is active. Replaces the standalone
                      settings panel that used to live on the Comms
                      page. */}
                  {isEditing && (
                    <div className="px-4 pb-4">
                      <ProjectSettingsCard
                        project={{
                          id: project.id,
                          name: project.name,
                          pin: project.pin,
                          status: project.status,
                          returnPhaseActive: project.returnPhaseActive,
                        }}
                        members={project.members}
                        isProjectAdmin={project.isProjectAdmin}
                        onClose={() => setEditingProjectId(null)}
                        onDeleted={() => setEditingProjectId(null)}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </PageLayout>
  )
}
