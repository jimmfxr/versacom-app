import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { ProjectsContent } from './projects-content'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const session = await getSession()
  const userName = session ? `${session.user.firstName} ${session.user.lastName}` : undefined

  const isAdmin = session?.memberships.some((m) => m.role === 'admin') ?? false
  const isUserOnly = session ? session.memberships.every((m) => m.role === 'user') : false
  const showMyEquipment = session?.memberships.some((m) => m.role === 'crew') ?? false

  // Admins see every project (active + archived). Managers/crew only see
  // projects they belong to — still includes archived so past shows remain
  // visible for reference.
  const projectFilter: { id?: { in: number[] } } = {}
  if (!isAdmin && session) {
    const memberProjectIds = session.memberships.map((m) => m.project.id)
    projectFilter.id = { in: memberProjectIds }
  }

  const projects = await prisma.project.findMany({
    where: projectFilter,
    select: {
      id: true,
      name: true,
      pin: true,
      status: true,
      returnPhaseActive: true,
      createdAt: true,
      createdBy: {
        select: { firstName: true, lastName: true },
      },
      members: {
        select: {
          id: true,
          role: true,
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      _count: {
        select: { members: true, equipment: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const currentUserId = session?.user.id ?? null

  return (
    <ProjectsContent
      userName={userName}
      isAdmin={isAdmin}
      isUserOnly={isUserOnly}
      showMyEquipment={showMyEquipment}
      projects={projects.map((p) => {
        const myMembership = currentUserId
          ? p.members.find((m) => m.user.id === currentUserId)
          : null
        // Admin on any project (global) → admin on every one of those
        // projects in the UI sense (can archive/delete). Otherwise the
        // per-project role decides.
        const isProjectAdmin = isAdmin || myMembership?.role === 'admin'
        return {
          id: p.id,
          name: p.name,
          pin: p.pin ?? '',
          status: p.status,
          returnPhaseActive: p.returnPhaseActive,
          createdAt: p.createdAt.toISOString(),
          createdBy: { firstName: p.createdBy.firstName, lastName: p.createdBy.lastName },
          memberCount: p._count.members,
          equipmentCount: p._count.equipment,
          isProjectAdmin,
          members: p.members.map((m) => ({
            id: m.id,
            userId: m.user.id,
            firstName: m.user.firstName,
            lastName: m.user.lastName,
            role: m.role,
          })),
        }
      })}
    />
  )
}
