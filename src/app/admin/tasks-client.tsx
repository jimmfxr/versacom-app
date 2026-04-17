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
  changeRequestId: number
  projectId: number
  projectName: string
  submitterName: string
  targetName: string
  targetPosition: string | null
  targetMemberId: number
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

function KeyIcon() {
  return (
    <svg className="size-5 text-[#22a7d3]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}

export function TasksClient({
  lockoutTasks,
  changeRequestTasks,
  userName,
  isAdmin,
}: {
  lockoutTasks: LockoutTask[]
  changeRequestTasks: ChangeRequestTask[]
  userName?: string
  isAdmin?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [unlockingId, setUnlockingId] = useState<string | null>(null)

  const totalTasks = lockoutTasks.length + changeRequestTasks.length

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
      <PageLayout title="Tasks">
        {totalTasks === 0 ? (
          <EmptyState icon={<CheckIcon />} title="Inbox zero" message="No pending tasks. All users are active and operational." />
        ) : (
          <div className="space-y-4">
            {/* Change Request cards */}
            {changeRequestTasks.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Key change requests
                  <span className="ml-1.5 text-xs opacity-70">{changeRequestTasks.length}</span>
                </h3>
                {changeRequestTasks.map((task) => (
                  <RowCard key={task.id}>
                    {/* Icon */}
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#0178a3]/15">
                      <KeyIcon />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">
                          {task.submitterName}
                        </span>
                        <StatusBadge
                          label={task.status === 'mgr_endorsed' ? 'Manager approved' : 'Pending review'}
                          color={task.status === 'mgr_endorsed' ? 'green' : 'amber'}
                        />
                      </div>
                      <div className="mt-1 text-xs text-gray-400">
                        {task.keyCount} key{task.keyCount !== 1 ? 's' : ''} requested for{' '}
                        <span className="text-white">{task.targetName}</span>
                        {task.targetPosition && <span className="text-gray-500"> · {task.targetPosition}</span>}
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
                        onClick={() => router.push(`/projects/${task.projectId}/panel/${task.equipmentId}`)}
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
            {lockoutTasks.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Lockouts
                  <span className="ml-1.5 text-xs opacity-70">{lockoutTasks.length}</span>
                </h3>
                {lockoutTasks.map((task) => (
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
