import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * Returns the current user's unread-notification count. Drives the
 * small red dot on the navbar bell. Polled every few seconds by
 * AppShell so the badge stays fresh without needing the user to
 * reload the app.
 *
 * Counts every notification with read=false for the current user,
 * including legacy rows from before the per-project filter was
 * added. The /notifications page itself filters by project, but
 * the badge intentionally aggregates across all projects so the
 * user knows there's SOMETHING unread without having to switch
 * project dropdown first.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ unread: 0 })

  const unread = await prisma.notification.count({
    where: { userId: session.user.id, read: false },
  })

  return NextResponse.json({ unread })
}
