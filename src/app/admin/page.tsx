import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { TasksClient } from './tasks-client'

export const dynamic = 'force-dynamic'

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  // Tasks are admin-only and scoped to projects the current user is admin
  // on. We query the DB fresh (instead of trusting session.memberships,
  // which is set at login and never refreshes) so projects created or
  // role-changed after login show up in the dropdown right away.
  const adminMemberships = await prisma.projectMember.findMany({
    where: {
      userId: session.user.id,
      role: 'admin',
      project: { status: 'active' },
    },
    select: { project: { select: { id: true, name: true } } },
  })
  const adminProjects = adminMemberships.map((m) => ({
    id: m.project.id,
    name: m.project.name,
  }))

  if (adminProjects.length === 0) redirect('/')

  // De-dup in case the same project appears multiple times in memberships.
  const adminProjectsMap = new Map<number, { id: number; name: string }>()
  for (const p of adminProjects) {
    if (!adminProjectsMap.has(p.id)) adminProjectsMap.set(p.id, p)
  }
  const userProjects = Array.from(adminProjectsMap.values()).sort((a, b) => a.name.localeCompare(b.name))

  // ?project= filter — falls back to the shared selectedProject cookie
  // (written by ProjectSwitcher on Dashboard / Tasks) so the chosen project
  // carries between pages, then to the first project when nothing is set.
  const params = await searchParams
  const urlId = params.project ? parseInt(params.project, 10) : NaN
  const cookieStore = await cookies()
  const cookieRaw = cookieStore.get('selectedProject')?.value
  const cookieId = cookieRaw ? parseInt(cookieRaw, 10) : NaN
  const selectedProjectId =
    Number.isFinite(urlId) && adminProjectsMap.has(urlId)
      ? urlId
      : Number.isFinite(cookieId) && adminProjectsMap.has(cookieId)
        ? cookieId
        : userProjects[0].id
  const adminProjectIds = [selectedProjectId]

  const [users, changeRequests] = await Promise.all([
    prisma.user.findMany({
      where: {
        // Only show locked users who are members of a project this admin runs.
        memberships: { some: { projectId: { in: adminProjectIds } } },
      },
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
      where: {
        status: { in: ['submitted', 'mgr_endorsed'] },
        projectId: { in: adminProjectIds },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        project: { select: { id: true, name: true } },
        submittedById: true,
        projectId: true,
        submittedBy: { select: { firstName: true, lastName: true } },
        targetMember: {
          select: {
            id: true,
            position: true,
            userId: true,
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

  // Look up submitter roles (userId + projectId → role)
  const submitterKeys = changeRequests.map((cr) => ({ userId: cr.submittedById, projectId: cr.projectId }))
  const submitterMembers = submitterKeys.length > 0
    ? await prisma.projectMember.findMany({
        where: {
          OR: submitterKeys.map((k) => ({ userId: k.userId, projectId: k.projectId })),
        },
        select: { userId: true, projectId: true, role: true },
      })
    : []
  const submitterRoleMap = new Map(
    submitterMembers.map((m) => [`${m.userId}-${m.projectId}`, m.role])
  )

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

  // Group change requests by submitter + target member into single cards
  const crGroupMap = new Map<string, {
    changeRequestIds: number[]
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
    bestStatus: string
    changes: Array<{ keyIndex: number; page: string; from: string | null; to: string | null }>
    latestCreatedAt: string
  }>()

  for (const cr of changeRequests) {
    const groupKey = `${cr.submittedById}-${cr.targetMember.id}`
    const targetName = `${cr.targetMember.user.firstName} ${cr.targetMember.user.lastName}`
    const submitterName = `${cr.submittedBy.firstName} ${cr.submittedBy.lastName}`
    const eq = cr.targetMember.equipment[0]
    const isSelf = cr.submittedById === cr.targetMember.userId

    const changes = cr.items.map((item) => {
      const prev = item.previousValue ? pickItemMap.get(parseInt(item.previousValue)) : null
      const next = item.newValue ? pickItemMap.get(parseInt(item.newValue)) : null
      return {
        keyIndex: item.panelKey.keyIndex,
        page: item.panelKey.page,
        from: prev?.name ?? null,
        to: next?.name ?? null,
      }
    })

    const existing = crGroupMap.get(groupKey)
    if (existing) {
      existing.changeRequestIds.push(cr.id)
      existing.changes.push(...changes)
      if (cr.status === 'mgr_endorsed') existing.bestStatus = 'mgr_endorsed'
      if (cr.createdAt.toISOString() > existing.latestCreatedAt) {
        existing.latestCreatedAt = cr.createdAt.toISOString()
      }
    } else {
      crGroupMap.set(groupKey, {
        changeRequestIds: [cr.id],
        projectId: cr.project.id,
        projectName: cr.project.name,
        submitterName,
        submitterRole: submitterRoleMap.get(`${cr.submittedById}-${cr.projectId}`) ?? 'crew',
        targetName,
        targetPosition: cr.targetMember.position,
        targetMemberId: cr.targetMember.id,
        isSelfRequest: isSelf,
        equipmentId: eq?.id ?? null,
        equipmentName: eq?.name ?? null,
        hardwareType: eq?.hardwareType ?? null,
        bestStatus: cr.status,
        changes,
        latestCreatedAt: cr.createdAt.toISOString(),
      })
    }
  }

  const changeRequestTasks = Array.from(crGroupMap.values()).map((group) => ({
    id: `cr-${group.changeRequestIds.join('-')}`,
    type: 'change-request' as const,
    projectId: group.projectId,
    projectName: group.projectName,
    submitterName: group.submitterName,
    submitterRole: group.submitterRole,
    targetName: group.targetName,
    targetPosition: group.targetPosition,
    targetMemberId: group.targetMemberId,
    isSelfRequest: group.isSelfRequest,
    equipmentId: group.equipmentId,
    equipmentName: group.equipmentName,
    hardwareType: group.hardwareType,
    status: group.bestStatus as 'submitted' | 'mgr_endorsed',
    keyCount: group.changes.length,
    changes: group.changes,
    createdAt: group.latestCreatedAt,
  }))

  const userName = `${session.user.firstName} ${session.user.lastName}`
  const isAdmin = true // already gated above

  return (
    <TasksClient
      lockoutTasks={lockoutTasks}
      changeRequestTasks={changeRequestTasks}
      userName={userName}
      isAdmin={isAdmin}
      userProjects={userProjects}
      selectedProjectId={selectedProjectId}
    />
  )
}
