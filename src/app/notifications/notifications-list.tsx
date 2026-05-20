'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/page-layout'
import { EmptyState } from '@/components/empty-state'
import { RowCard } from '@/components/row-card'
import { ProjectSwitcher } from '@/app/project-dashboard'
import {
  markNotificationRead,
  markAllNotificationsRead,
  clearAllNotifications,
} from './actions'

type NotificationItem = {
  id: number
  title: string
  body: string | null
  url: string | null
  read: boolean
  createdAt: string
}

type UserProject = { id: number; name: string }

/**
 * Renders the notification list + the header actions ("Mark all read",
 * "Clear all"). Tapping a row marks it read and follows its URL (if
 * any). Page navigates rather than opening a new tab — keeps the
 * single-app feel for crew on mobile.
 */
export function NotificationsList({
  notifications,
  userProjects,
  filteredProjectId,
}: {
  notifications: NotificationItem[]
  userProjects: UserProject[]
  /** null = "All shows" filter is active. */
  filteredProjectId: number | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const unreadCount = notifications.filter((n) => !n.read).length

  function handleRowClick(n: NotificationItem) {
    startTransition(async () => {
      // Mark read first so the user lands on the destination with the
      // history already updated. Read state on a row that didn't move
      // is harmless if the user just hits Back.
      if (!n.read) {
        await markNotificationRead(n.id)
      }
      if (n.url) router.push(n.url)
      else router.refresh()
    })
  }

  function handleMarkAllRead() {
    if (unreadCount === 0) return
    startTransition(async () => {
      await markAllNotificationsRead()
      router.refresh()
    })
  }

  function handleClearAll() {
    if (notifications.length === 0) return
    const ok = window.confirm('Clear all notifications? This cannot be undone.')
    if (!ok) return
    startTransition(async () => {
      await clearAllNotifications()
      router.refresh()
    })
  }

  // Project switcher on the right side of the page header — same
  // chrome as Dashboard / Tasks / My Equipment. "All shows" entry
  // included so the user can see notifications from every project at
  // once. basePath stays on /notifications so picks land back here.
  const filteredProject = filteredProjectId != null
    ? userProjects.find((p) => p.id === filteredProjectId) ?? null
    : null
  const switcher = userProjects.length > 0 ? (
    <ProjectSwitcher
      projectId={filteredProject?.id ?? null}
      projectName={filteredProject?.name ?? 'All shows'}
      userProjects={userProjects}
      basePath="/notifications"
      showAllOption
      allLabel="All shows"
    />
  ) : null

  return (
    <PageLayout
      title="Notifications"
      titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
      bottomBorder
      action={
        // Order: switcher (1) → buttons (2) on mobile (top-to-bottom).
        // On desktop the order is flipped via sm:order-* so the buttons
        // sit LEFT of the project dropdown, matching the action-row
        // convention used elsewhere in the app (contextual actions on
        // the left, navigational dropdown on the right).
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="order-1 sm:order-2">
            {switcher}
          </div>
          {notifications.length > 0 && (
            <div className="order-2 flex items-center gap-2 sm:order-1">
              {/* Padding + text + border-2 chrome matches the
                  ProjectSwitcher trigger sitting next to these buttons
                  on desktop, so the row reads as a uniform action-bar
                  rather than two visual weights. */}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={isPending}
                  className="rounded-lg border-2 border-white/10 px-3.5 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={handleClearAll}
                disabled={isPending}
                className="rounded-lg border-2 border-red-500/40 bg-red-500/10 px-3.5 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      }
    >
      {notifications.length === 0 ? (
        <EmptyState
          icon={
            <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
            </svg>
          }
          title="No notifications yet"
          message="Activity from your projects (deploys, returns, change requests) will show up here."
        />
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {notifications.map((n) => (
            <RowCard key={n.id} onClick={() => handleRowClick(n)}>
              {/* Unread indicator — small cyan dot on the left. Reserves
                  space even on read rows so the title aligns vertically
                  across the list (no jumping when state changes). */}
              <span
                className={`size-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-[#22a7d3]'}`}
                aria-label={n.read ? undefined : 'Unread'}
              />
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-semibold ${n.read ? 'text-gray-400' : 'text-white'}`}>
                  {n.title}
                </div>
                {n.body && (
                  <div className="mt-0.5 truncate text-xs text-gray-500">{n.body}</div>
                )}
              </div>
              <div className="shrink-0 text-[11px] text-gray-500">
                {relativeTime(n.createdAt)}
              </div>
            </RowCard>
          ))}
        </div>
      )}
    </PageLayout>
  )
}

/** Compact relative-time format for the right-aligned timestamp. Just
 *  enough resolution to read at a glance — minutes, hours, days, then
 *  the date for anything past a week. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = now - then
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
