import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { getUserPrefs } from '@/lib/notification-prefs'
import { NotificationsList } from './notifications-list'

export const dynamic = 'force-dynamic'

/**
 * Notification history. Server-loads every notification for the current
 * user, scoped to whichever project they have selected (or all shows
 * when they pick "All shows" via the dropdown), newest first.
 *
 * Project filter resolution mirrors /tasks: ?project=N from the URL,
 * then the shared `selectedProject` cookie, then "all". Picking a
 * value in the ProjectSwitcher dropdown writes the cookie + updates
 * the URL, which keeps every page (/tasks, /, /my-equipment,
 * /notifications) in sync.
 *
 * Persistence happens inside safeSend() in src/lib/notifications.ts —
 * every push the app sends already writes one row per recipient.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  // Pull every active project the user belongs to — feeds the
  // ProjectSwitcher dropdown. Also collect roles so the settings card
  // can decide whether to render admin-scoped toggles for this user.
  const memberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id, project: { status: 'active' } },
    select: { role: true, project: { select: { id: true, name: true } } },
  })
  const isAdminAnywhere = memberships.some((m) => m.role === 'admin')
  const userProjectsMap = new Map<number, { id: number; name: string }>()
  for (const m of memberships) {
    if (!userProjectsMap.has(m.project.id)) {
      userProjectsMap.set(m.project.id, { id: m.project.id, name: m.project.name })
    }
  }
  const userProjects = Array.from(userProjectsMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
  const userProjectIds = userProjects.map((p) => p.id)

  // Resolve current project filter: ?project= → cookie → null (= all).
  const params = await searchParams
  const urlProjectId = params.project ? parseInt(params.project, 10) : NaN
  const cookieStore = await cookies()
  const cookieRaw = cookieStore.get('selectedProject')?.value
  const cookieProjectId = cookieRaw ? parseInt(cookieRaw, 10) : NaN
  const resolved = Number.isFinite(urlProjectId)
    ? urlProjectId
    : Number.isFinite(cookieProjectId)
      ? cookieProjectId
      : null
  // Guard: only honour the resolved id if the user actually belongs to it.
  // Otherwise null out (treat as "All shows") so we don't show notifications
  // from a project they no longer have access to.
  const filteredProjectId =
    resolved != null && userProjects.some((p) => p.id === resolved) ? resolved : null

  // Where-clause: user's notifications, optionally scoped to one
  // project. When no project is selected, include EVERY notification
  // belonging to the user — but only ones from active projects they
  // belong to OR ones with projectId null (account-level pings).
  const rows = await prisma.notification.findMany({
    where: {
      userId: session.user.id,
      ...(filteredProjectId
        ? { projectId: filteredProjectId }
        : {
            OR: [
              { projectId: null },
              { projectId: { in: userProjectIds } },
            ],
          }),
    },
    select: {
      id: true,
      title: true,
      body: true,
      url: true,
      read: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const prefs = await getUserPrefs(session.user.id)

  return (
    <NotificationsList
      notifications={rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        url: n.url,
        read: n.read,
        // Serialize for client component — Date isn't transferable as-is.
        createdAt: n.createdAt.toISOString(),
      }))}
      userProjects={userProjects}
      filteredProjectId={filteredProjectId}
      prefs={prefs}
      isAdminAnywhere={isAdminAnywhere}
    />
  )
}
