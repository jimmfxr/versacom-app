'use client'

import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/page-header'
import { ToastContainer, showToast } from '@/components/toast'
import { Button } from '@/components/button'
import { AppShell } from '@/components/app-shell'

type User = {
  id: number
  firstName: string
  lastName: string
  failedAttempts: number
  lockedUntil: string | null
  lastFailedAt: string | null
  createdAt: string
  memberships: { role: string; project: { name: string } }[]
}

type TaskItem = {
  id: string
  type: 'lockout'
  user: User
  status: 'locked' | 'warning'
  timestamp: string
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

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [unlocking, setUnlocking] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users')
      if (!res.ok) return
      const users: User[] = await res.json()

      const items: TaskItem[] = []

      for (const user of users) {
        if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
          items.push({
            id: `lockout-${user.id}`,
            type: 'lockout',
            user,
            status: 'locked',
            timestamp: user.lockedUntil,
          })
        }
      }

      // Sort: locked first, then by timestamp (newest first)
      items.sort((a, b) => {
        if (a.status === 'locked' && b.status !== 'locked') return -1
        if (a.status !== 'locked' && b.status === 'locked') return 1
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      })

      setTasks(items)
    } catch {
      // silently fail
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchTasks()
    const interval = setInterval(fetchTasks, 15000)
    return () => clearInterval(interval)
  }, [fetchTasks])

  async function handleUnlock(task: TaskItem) {
    setUnlocking(task.id)
    try {
      const res = await fetch(`/api/admin/users/${task.user.id}/unlock`, { method: 'PATCH' })
      const data = await res.json()
      if (res.ok) {
        showToast('success', data.message)
      } else {
        showToast('error', data.error || 'Failed to unlock user')
      }
    } catch {
      showToast('error', 'Network error. Please try again.')
    }
    await fetchTasks()
    setUnlocking(null)
  }

  return (
    <AppShell>
      <div className="py-10">
        <PageHeader title="Tasks" />
        <main>
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {loading ? (
              <p className="text-gray-400">Loading tasks...</p>
            ) : tasks.length === 0 ? (
              <div className="rounded-2xl bg-[#2a2a2a] p-12 text-center">
                <svg className="mx-auto size-12 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <p className="mt-4 text-base font-medium text-white">Inbox zero</p>
                <p className="mt-1 text-sm text-gray-400">No pending tasks. All users are active and operational.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-4 rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-colors hover:bg-[#313131]"
                  >
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
                          {task.user.firstName} {task.user.lastName}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          task.status === 'locked'
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-amber-500/15 text-amber-400'
                        }`}>
                          {task.status === 'locked' ? 'Locked out' : `${task.user.failedAttempts}/10 failed`}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                        {task.status === 'locked' && task.user.lockedUntil && (
                          <>
                            <span>{formatTime(task.user.lockedUntil)}</span>
                            <span>·</span>
                            <LockoutTimer lockedUntil={task.user.lockedUntil} />
                            <span>·</span>
                          </>
                        )}
                        {task.status === 'warning' && task.user.lastFailedAt && (
                          <>
                            <span>{formatTime(task.user.lastFailedAt)}</span>
                            <span>·</span>
                          </>
                        )}
                        <span>{task.user.failedAttempts} failed attempts</span>
                      </div>
                    </div>

                    {/* Action */}
                    <Button
                      onClick={() => handleUnlock(task)}
                      disabled={unlocking === task.id}
                      size="sm"
                    >
                      {unlocking === task.id ? 'Unlocking...' : 'Unlock'}
                    </Button>
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
