'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { showToast } from '@/components/toast'
import { Button } from '@/components/button'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'
import { EmptyState } from '@/components/empty-state'
import { RowCard } from '@/components/row-card'
import { StatusBadge } from '@/components/status-badge'
import { unlockUser } from './actions'
import { ProjectSwitcher } from '@/app/project-dashboard'

type LockoutTask = {
  id: string
  type: 'lockout'
  userId: number
  firstName: string
  lastName: string
  failedAttempts: number
  status: 'locked' | 'warning'
  lockedUntil: string | null
  lastFailedAt: string | null
}

type ChangeRequestTask = {
  id: string
  type: 'change-request'
  projectId: number
  projectName: string
  submitterName: string
  submitterRole: string
  targetName: string
  targetPosition: string | null
  targetMemberId: number
  isSelfRequest: boolean
  equipmentId: number | null
  equipmentName: string | null
  hardwareType: string | null
  status: 'submitted' | 'mgr_endorsed'
  keyCount: number
  changes: Array<{
    keyIndex: number
    page: string
    from: string | null
    to: string | null
  }>
  createdAt: string
}

function LockoutTimer({ lockedUntil }: { lockedUntil: string }) {
  const [remaining, setRemaining] = useState('')

  useEffect(() => {
    function update() {
      const diff = new Date(lockedUntil).getTime() - Date.now()
      if (diff <= 0) {
        setRemaining('Expired')
        return
      }
      const mins = Math.floor(diff / 60000)
      const secs = Math.floor((diff % 60000) / 1000)
      setRemaining(`${mins}:${secs.toString().padStart(2, '0')}`)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [lockedUntil])

  return <span className="font-mono text-amber-400">{remaining}</span>
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function CheckIcon() {
  return (
    <svg className="size-12 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}


export function TasksClient({
  lockoutTasks,
  changeRequestTasks,
  userName,
  isAdmin,
  userProjects = [],
  selectedProjectId = null,
}: {
  lockoutTasks: LockoutTask[]
  changeRequestTasks: ChangeRequestTask[]
  userName?: string
  isAdmin?: boolean
  /** Admin's projects, drives the top-right project switcher. */
  userProjects?: Array<{ id: number; name: string }>
  /** Currently-filtered project, or null for "All shows". */
  selectedProjectId?: number | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [unlockingId, setUnlockingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  // Auto-refresh to pick up new requests
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh()
    }, 5000)
    return () => clearInterval(interval)
  }, [router])

  // Search filter — matches submitter, target, project, equipment, hardware
  // for change requests, and first/last name for lockouts.
  const q = search.trim().toLowerCase()
  const filteredLockoutTasks = q.length === 0
    ? lockoutTasks
    : lockoutTasks.filter((t) => {
        const haystack = [t.firstName, t.lastName, `${t.firstName} ${t.lastName}`]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
  const filteredChangeRequestTasks = q.length === 0
    ? changeRequestTasks
    : changeRequestTasks.filter((t) => {
        const haystack = [
          t.submitterName,
          t.submitterRole,
          t.targetName,
          t.targetPosition,
          t.projectName,
          t.equipmentName,
          t.hardwareType,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })

  const totalTasks = filteredLockoutTasks.length + filteredChangeRequestTasks.length
  const hasAnyTasks = lockoutTasks.length + changeRequestTasks.length > 0

  const desktopSearchInput = (
    <div className="hidden sm:block">
      <input
        type="text"
        placeholder="Search tasks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-64 rounded-lg border border-white/10 px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
      />
    </div>
  )

  const mobileSearchToggle = !mobileSearchOpen && (
    <button
      type="button"
      onClick={() => setMobileSearchOpen(true)}
      aria-label="Search"
      className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white sm:hidden"
    >
      <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.343-4.343m0 0A8 8 0 1 0 5.343 5.343a8 8 0 0 0 11.314 11.314Z" />
      </svg>
    </button>
  )

  const projectSwitcher = userProjects.length > 1 ? (
    <ProjectSwitcher
      projectId={selectedProjectId}
      projectName={
        userProjects.find((p) => p.id === selectedProjectId)?.name ?? userProjects[0].name
      }
      userProjects={userProjects}
      basePath="/admin"
    />
  ) : null

  function handleUnlock(task: LockoutTask) {
    setUnlockingId(task.id)
    startTransition(async () => {
      const result = await unlockUser(task.userId)
      if (result.error) {
        showToast('error', result.error)
      } else {
        showToast('success', result.message!)
      }
      setUnlockingId(null)
      router.refresh()
    })
  }

  return (
    <AppShell userName={userName} isAdmin={isAdmin}>
      <PageLayout
        title="Tasks"
        titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
        stickyHeader
        bottomBorder
        action={
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {/* Desktop: search input left of project switcher. */}
            {desktopSearchInput}
            {/* Mobile: project dropdown grows to fill, search icon
                + (optional) project switcher sit to its right. The
                project switcher itself is always visible if shown. */}
            <div className="min-w-0 flex-1 sm:flex-initial">
              {projectSwitcher}
            </div>
            {mobileSearchToggle}
          </div>
        }
      >
        {/* Mobile-only collapsible search row — opens when the
            search icon to the right of the project dropdown is
            tapped. The X on the right closes it again. */}
        {mobileSearchOpen && (
          <div className="mb-3 flex items-center gap-2 sm:hidden">
            <input
              type="text"
              autoFocus
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full flex-1 rounded-lg border border-white/10 px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
            />
            <button
              type="button"
              onClick={() => { setMobileSearchOpen(false); setSearch('') }}
              aria-label="Close search"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
            >
              <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {!hasAnyTasks ? (
          <EmptyState icon={<CheckIcon />} title="Inbox zero" message="No pending tasks. All users are active and operational." />
        ) : totalTasks === 0 ? (
          <EmptyState icon={<CheckIcon />} title="No matches" message="No tasks match your search." />
        ) : (
          // Desktop: scrollable list region inside the kiosk-style flex
          // chain. Mobile: page-level scroll, this div is just a normal
          // space-y-4 container.
          <div data-scroll-container className="space-y-4 sm:flex-1 sm:overflow-y-auto sm:overscroll-none sm:pt-1 sm:pb-20">
            {/* Change Request cards */}
            {filteredChangeRequestTasks.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Key change requests
                  <span className="ml-1.5 text-xs opacity-70">{filteredChangeRequestTasks.length}</span>
                </h3>
                {filteredChangeRequestTasks.map((task) => (
                  <RowCard key={task.id}>
                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">
                          {task.submitterName}
                        </span>
                        <StatusBadge
                          label={task.status === 'mgr_endorsed' ? 'Manager approved' : task.submitterRole === 'manager' ? 'Manager pending review' : 'Pending review'}
                          color={task.status === 'mgr_endorsed' ? 'green' : 'amber'}
                        />
                      </div>
                      <div className="mt-1 text-xs text-gray-400">
                        {task.isSelfRequest ? (
                          <>
                            {task.keyCount} key{task.keyCount !== 1 ? 's' : ''} requested
                          </>
                        ) : (
                          <>
                            {task.keyCount} key{task.keyCount !== 1 ? 's' : ''} requested for{' '}
                            <span className="text-white">{task.targetName}</span>
                            {task.targetPosition && <span className="text-gray-500"> · {task.targetPosition}</span>}
                          </>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                        <span>{task.projectName}</span>
                        {task.equipmentName && (
                          <>
                            <span>·</span>
                            <span>{task.equipmentName}</span>
                          </>
                        )}
                        {task.hardwareType && (
                          <>
                            <span>·</span>
                            <span>{task.hardwareType}</span>
                          </>
                        )}
                        <span>·</span>
                        <span>{formatTime(task.createdAt)}</span>
                      </div>
                      {/* Change summary */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {task.changes.map((ch, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded bg-white/[0.06] px-2 py-0.5 text-[10px] text-gray-300"
                          >
                            <span className="text-gray-500">Key {ch.keyIndex + 1}</span>
                            {ch.from && <span className="text-red-400 line-through">{ch.from}</span>}
                            <span className="text-green-400">{ch.to ?? 'empty'}</span>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Review button */}
                    {task.equipmentId && (
                      <Button
                        onClick={() => router.push(`/projects/${task.projectId}/panel/${task.equipmentId}?review=${task.targetMemberId}`)}
                        size="sm"
                      >
                        Review
                      </Button>
                    )}
                  </RowCard>
                ))}
              </div>
            )}

            {/* Lockout cards */}
            {filteredLockoutTasks.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Lockouts
                  <span className="ml-1.5 text-xs opacity-70">{filteredLockoutTasks.length}</span>
                </h3>
                {filteredLockoutTasks.map((task) => (
                  <RowCard key={task.id}>
                    <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                      task.status === 'locked' ? 'bg-red-500/15' : 'bg-amber-500/15'
                    }`}>
                      <svg className={`size-5 ${task.status === 'locked' ? 'text-red-400' : 'text-amber-400'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">
                          {task.firstName} {task.lastName}
                        </span>
                        <StatusBadge
                          label={task.status === 'locked' ? 'Locked out' : `${task.failedAttempts}/10 failed`}
                          color={task.status === 'locked' ? 'red' : 'amber'}
                        />
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                        {task.status === 'locked' && task.lockedUntil && (
                          <>
                            <span>{formatTime(task.lockedUntil)}</span>
                            <span>·</span>
                            <LockoutTimer lockedUntil={task.lockedUntil} />
                            <span>·</span>
                          </>
                        )}
                        {task.status === 'warning' && task.lastFailedAt && (
                          <>
                            <span>{formatTime(task.lastFailedAt)}</span>
                            <span>·</span>
                          </>
                        )}
                        <span>{task.failedAttempts} failed attempts</span>
                      </div>
                    </div>
                    <Button onClick={() => handleUnlock(task)} disabled={isPending && unlockingId === task.id} size="sm">
                      {isPending && unlockingId === task.id ? 'Unlocking...' : 'Unlock'}
                    </Button>
                  </RowCard>
                ))}
              </div>
            )}
          </div>
        )}
      </PageLayout>
    </AppShell>
  )
}
