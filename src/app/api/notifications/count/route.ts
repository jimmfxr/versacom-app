import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * Returns the current user's unread-notification count for the navbar
 * bell badge. Polled every few seconds by AppShell.
 *
 * Filter mirrors /notifications exactly so the badge and the page
 * agree: when the user has a `selectedProject` cookie (set by the
 * ProjectSwitcher), count only that project's unread. Otherwise
 * ("All shows" / no selection), count unread across every project
 * the user currently belongs to + account-level pings (projectId
 * null). Notifications from projects the user has been removed from
 * are excluded either way.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ unread: 0 })

  const cookieStore = await cookies()
  const cookieRaw = cookieStore.get('selectedProject')?.value
  const cookieProjectId = cookieRaw ? parseInt(cookieRaw, 10) : NaN

  const memberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id, project: { status: 'active' } },
    select: { projectId: true },
  })
  const userProjectIds = memberships.map((m) => m.projectId)

  // Only honour the cookie if the user still belongs to that project.
  const filteredProjectId =
    Number.isFinite(cookieProjectId) && userProjectIds.includes(cookieProjectId)
      ? cookieProjectId
      : null

  const unread = await prisma.notification.count({
    where: {
      userId: session.user.id,
      read: false,
      ...(filteredProjectId
        ? { projectId: filteredProjectId }
        : {
            OR: [
              { projectId: null },
              { projectId: { in: userProjectIds } },
            ],
          }),
    },
  })

  return NextResponse.json({ unread })
}
