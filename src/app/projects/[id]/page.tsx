import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { ProjectPage } from './project-page'

export const dynamic = 'force-dynamic'

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) notFound()

  const [project, equipment, memberRows, pickListItems, panelKeyUsage, expansionRows] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        pin: true,
        status: true,
        createdAt: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        members: {
          select: {
            id: true,
            role: true,
            position: true,
            location: true,
            // `pin` is selected only to compute `hasPin` below — never shipped
            // to the client. It's null until the user completes their first
            // login via the project PIN and sets a personal PIN.
            user: { select: { id: true, firstName: true, lastName: true, pin: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    }),
    prisma.equipment.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        category: true,
        hardwareType: true,
        position: true,
        location: true,
        headsetType: true,
        ipAddress: true,
        patch: true,
        deployStatus: true,
        assignedToId: true,
        assignedTo: {
          select: {
            id: true,
            position: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [{ category: 'asc' }, { id: 'asc' }],
    }),
    prisma.projectMember.findMany({
      where: { projectId },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.pickListItem.findMany({
      where: { projectId },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { id: 'asc' },
    }),
    // Pick list usage: which user has each pick list item assigned to a panel
    // key (across main + shift + any expansion). Used to render "X, Y, Z" in
    // cyan beneath each pick list card on the project's Pick List tab.
    prisma.panelKey.findMany({
      where: {
        pickListItemId: { not: null },
        projectMember: { projectId },
      },
      select: {
        pickListItemId: true,
        projectMember: {
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
    // Expansion modules per member: a row exists for every (member, expansion)
    // combo that has at least one key. Counted client-side to render "exp: N"
    // next to each member's equipment on the Team tab.
    prisma.panelKey.findMany({
      where: {
        projectMember: { projectId },
        expansion: { gt: 0 },
      },
      select: { projectMemberId: true, expansion: true },
      distinct: ['projectMemberId', 'expansion'],
    }),
  ])

  if (!project) notFound()

  // Build equipment-per-member map
  const memberEquipmentMap: Record<number, string[]> = {}
  for (const e of equipment) {
    if (e.assignedToId) {
      if (!memberEquipmentMap[e.assignedToId]) memberEquipmentMap[e.assignedToId] = []
      memberEquipmentMap[e.assignedToId].push(e.name)
    }
  }

  // Build pick-list usage map: pickListItemId → sorted, deduped user names
  const pickListUsageMap = new Map<number, Set<string>>()
  for (const k of panelKeyUsage) {
    if (k.pickListItemId == null) continue
    const name = `${k.projectMember.user.firstName} ${k.projectMember.user.lastName}`
    if (!pickListUsageMap.has(k.pickListItemId)) pickListUsageMap.set(k.pickListItemId, new Set())
    pickListUsageMap.get(k.pickListItemId)!.add(name)
  }

  // Build expansion-count map: projectMemberId → number of expansion modules
  const expansionCountMap = new Map<number, number>()
  for (const e of expansionRows) {
    expansionCountMap.set(e.projectMemberId, (expansionCountMap.get(e.projectMemberId) ?? 0) + 1)
  }

  const session = await getSession()
  const userName = session ? `${session.user.firstName} ${session.user.lastName}` : undefined

  // Find the current user's role and member ID for this project
  const currentMembership = session
    ? project.members.find((m) => m.user.id === session.user.id)
    : null
  // Global admins (admin on any project) get 'admin' role on every project
  // they view — even if they have no explicit membership on this one.
  // This covers the orphan-project case where the admin's own membership
  // was wiped by an earlier incomplete delete, leaving them locked out of
  // the controls that would let them clean up.
  const isGlobalAdmin = session?.memberships.some((m) => m.role === 'admin') ?? false
  const currentUserRole = currentMembership?.role || (isGlobalAdmin ? 'admin' : 'user')
  const currentMemberId = currentMembership?.id || null

  const isAdmin = session?.memberships.some((m) => m.role === 'admin') ?? false
  const isUserOnly = session ? session.memberships.every((m) => m.role === 'user') : false

  // Non-admins can only view projects they belong to
  if (!isAdmin && !currentMembership) notFound()

  return (
    <ProjectPage
      userName={userName}
      isAdmin={isAdmin}
      isUserOnly={isUserOnly}
      currentUserRole={currentUserRole}
      currentMemberId={currentMemberId}
      project={{
        id: project.id,
        name: project.name,
        pin: project.pin || '',
        status: project.status,
        createdAt: project.createdAt.toISOString(),
        createdBy: project.createdBy,
        members: project.members.map((m) => ({
          id: m.id,
          role: m.role,
          position: m.position,
          location: m.location,
          userId: m.user.id,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          equipmentNames: memberEquipmentMap[m.id] || [],
          expansionCount: expansionCountMap.get(m.id) ?? 0,
          hasPin: Boolean(m.user.pin),
        })),
      }}
      equipment={equipment.map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category,
        hardwareType: e.hardwareType,
        position: e.position,
        location: e.location,
        headsetType: e.headsetType,
        ipAddress: e.ipAddress,
        patch: e.patch,
        deployStatus: e.deployStatus,
        assignedToId: e.assignedToId,
        assignedToName: e.assignedTo
          ? `${e.assignedTo.user.firstName} ${e.assignedTo.user.lastName}`
          : null,
        assignedToPosition: e.assignedTo?.position ?? null,
        assignedMemberId: e.assignedTo?.id ?? null,
      }))}
      assignableMembers={memberRows.map((m) => ({
        id: m.id,
        name: `${m.user.firstName} ${m.user.lastName}`,
      }))}
      pickListItems={pickListItems.map((p) => ({
        ...p,
        users: Array.from(pickListUsageMap.get(p.id) ?? []).sort((a, b) =>
          a.localeCompare(b),
        ),
      }))}
    />
  )
}
