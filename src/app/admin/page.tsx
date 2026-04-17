import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { TasksClient } from './tasks-client'

export default async function TasksPage() {
  const [users, changeRequests] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        failedAttempts: true,
        lockedUntil: true,
        lastFailedAt: true,
      },
      orderBy: { firstName: 'asc' },
    }),
    prisma.changeRequest.findMany({
      where: { status: { in: ['submitted', 'mgr_endorsed'] } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        project: { select: { id: true, name: true } },
        submittedBy: { select: { firstName: true, lastName: true } },
        targetMember: {
          select: {
            id: true,
            position: true,
            user: { select: { firstName: true, lastName: true } },
            equipment: {
              select: { id: true, name: true, hardwareType: true },
              take: 1,
            },
          },
        },
        items: {
          select: {
            id: true,
            fieldChanged: true,
            previousValue: true,
            newValue: true,
            panelKey: {
              select: { keyIndex: true, page: true, expansion: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // Collect all pickListItem IDs referenced in change request items
  const pickItemIds = new Set<number>()
  for (const cr of changeRequests) {
    for (const item of cr.items) {
      if (item.newValue) pickItemIds.add(parseInt(item.newValue))
      if (item.previousValue) pickItemIds.add(parseInt(item.previousValue))
    }
  }
  const pickItems = pickItemIds.size > 0
    ? await prisma.pickListItem.findMany({
        where: { id: { in: Array.from(pickItemIds) } },
        select: { id: true, name: true, type: true },
      })
    : []
  const pickItemMap = new Map(pickItems.map((p) => [p.id, p]))

  const now = new Date()
  const lockoutTasks = users
    .filter((u) => u.lockedUntil && new Date(u.lockedUntil) > now)
    .map((u) => ({
      id: `lockout-${u.id}`,
      type: 'lockout' as const,
      userId: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      failedAttempts: u.failedAttempts,
      status: 'locked' as const,
      lockedUntil: u.lockedUntil?.toISOString() ?? null,
      lastFailedAt: u.lastFailedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => new Date(b.lockedUntil!).getTime() - new Date(a.lockedUntil!).getTime())

  const changeRequestTasks = changeRequests.map((cr) => {
    const targetName = `${cr.targetMember.user.firstName} ${cr.targetMember.user.lastName}`
    const submitterName = `${cr.submittedBy.firstName} ${cr.submittedBy.lastName}`
    const eq = cr.targetMember.equipment[0]

    return {
      id: `cr-${cr.id}`,
      type: 'change-request' as const,
      changeRequestId: cr.id,
      projectId: cr.project.id,
      projectName: cr.project.name,
      submitterName,
      targetName,
      targetPosition: cr.targetMember.position,
      targetMemberId: cr.targetMember.id,
      equipmentId: eq?.id ?? null,
      equipmentName: eq?.name ?? null,
      hardwareType: eq?.hardwareType ?? null,
      status: cr.status as 'submitted' | 'mgr_endorsed',
      keyCount: cr.items.length,
      changes: cr.items.map((item) => {
        const prev = item.previousValue ? pickItemMap.get(parseInt(item.previousValue)) : null
        const next = item.newValue ? pickItemMap.get(parseInt(item.newValue)) : null
        return {
          keyIndex: item.panelKey.keyIndex,
          page: item.panelKey.page,
          from: prev?.name ?? null,
          to: next?.name ?? null,
        }
      }),
      createdAt: cr.createdAt.toISOString(),
    }
  })

  const session = await getSession()
  const userName = session ? `${session.user.firstName} ${session.user.lastName}` : undefined

  const isAdmin = session?.memberships.some((m) => m.role === 'admin') ?? false

  return (
    <TasksClient
      lockoutTasks={lockoutTasks}
      changeRequestTasks={changeRequestTasks}
      userName={userName}
      isAdmin={isAdmin}
    />
  )
}
