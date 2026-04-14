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

type TaskItem = {
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

export function TasksClient({ tasks }: { tasks: TaskItem[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [unlockingId, setUnlockingId] = useState<string | null>(null)

  function handleUnlock(task: TaskItem) {
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
    <AppShell>
      <PageLayout title="Tasks">
        {tasks.length === 0 ? (
          <EmptyState icon={<CheckIcon />} title="Inbox zero" message="No pending tasks. All users are active and operational." />
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <RowCard key={task.id}>
                {/* Icon */}
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                  task.status === 'locked' ? 'bg-red-500/15' : 'bg-amber-500/15'
                }`}>
                  <svg className={`size-5 ${task.status === 'locked' ? 'text-red-400' : 'text-amber-400'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                </div>

                {/* Content */}
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

                {/* Action */}
                <Button onClick={() => handleUnlock(task)} disabled={isPending && unlockingId === task.id} size="sm">
                  {isPending && unlockingId === task.id ? 'Unlocking...' : 'Unlock'}
                </Button>
              </RowCard>
            ))}
          </div>
        )}
      </PageLayout>
    </AppShell>
  )
}
