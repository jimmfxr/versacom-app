'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { showToast } from '@/components/toast'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'
import { Avatar } from '@/components/avatar'
import { StatusBadge } from '@/components/status-badge'
import { unlockUser } from '../actions'

type User = {
  id: number
  firstName: string
  lastName: string
  failedAttempts: number
  lockedUntil: string | null
  lastFailedAt: string | null
  projectName: string | null
  role: string | null
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

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function getStatus(user: User) {
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) return 'locked'
  if (user.failedAttempts > 0) return 'warning'
  return 'ok'
}

export function LockoutsClient({ users, userName, isAdmin }: { users: User[]; userName?: string; isAdmin?: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [unlockingId, setUnlockingId] = useState<number | null>(null)

  function handleUnlock(userId: number) {
    setUnlockingId(userId)
    startTransition(async () => {
      const result = await unlockUser(userId)
      if (result.error) {
        showToast('error', result.error)
      } else {
        showToast('success', result.message!)
      }
      setUnlockingId(null)
      router.refresh()
    })
  }

  const actionableUsers = users.filter((u) => getStatus(u) !== 'ok')
  const activeUsers = users.filter((u) => getStatus(u) === 'ok')

  return (
    <AppShell userName={userName} isAdmin={isAdmin}>
      <PageLayout title="User Lockouts" bottomBorder>
        <div className="space-y-8">
          {/* Needs attention */}
          {actionableUsers.length > 0 && (
            <div>
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
                Needs Attention ({actionableUsers.length})
              </h3>
              <div className="space-y-3">
                {actionableUsers.map((user) => {
                  const status = getStatus(user)
                  return (
                    <div
                      key={user.id}
                      className={`flex items-center justify-between rounded-xl border p-4 ${
                        status === 'locked'
                          ? 'border-red-500/20 bg-red-500/5'
                          : 'border-amber-500/20 bg-amber-500/5'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <Avatar name={`${user.firstName} ${user.lastName}`} size="md" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">
                              {user.firstName} {user.lastName}
                            </span>
                            {status === 'locked' ? (
                              <StatusBadge label="Locked" color="red" />
                            ) : (
                              <StatusBadge label={`${user.failedAttempts}/10 attempts`} color="amber" />
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-400">
                            {status === 'locked' && user.lockedUntil && (
                              <>
                                <span>Locked: {formatDateTime(user.lockedUntil)}</span>
                                <span className="text-gray-600">|</span>
                                <span>Remaining: <LockoutTimer lockedUntil={user.lockedUntil} /></span>
                              </>
                            )}
                            {status === 'warning' && user.lastFailedAt && (
                              <span>Last failed: {formatDateTime(user.lastFailedAt)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleUnlock(user.id)}
                        disabled={isPending && unlockingId === user.id}
                        className="rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:opacity-50"
                      >
                        {isPending && unlockingId === user.id ? 'Unlocking...' : 'Unlock'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {actionableUsers.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-[#2a2a2a] p-8 text-center">
              <svg className="mx-auto size-10 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <p className="mt-3 text-sm font-medium text-white">All clear</p>
              <p className="mt-1 text-xs text-gray-400">No locked or at-risk accounts right now.</p>
            </div>
          )}

          {/* Active users */}
          {activeUsers.length > 0 && (
            <div>
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
                Active Users ({activeUsers.length})
              </h3>
              <div className="space-y-3">
                {activeUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-[#2a2a2a] p-4"
                  >
                    <div className="flex items-center gap-4">
                      <Avatar name={`${user.firstName} ${user.lastName}`} size="md" />
                      <div>
                        <span className="text-sm font-semibold text-white">
                          {user.firstName} {user.lastName}
                        </span>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {user.projectName ?? 'No project'} — {user.role ?? 'none'}
                        </div>
                      </div>
                    </div>
                    <StatusBadge label="Active" color="green" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </PageLayout>
    </AppShell>
  )
}
