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
      status: true,
      createdAt: true,
      createdBy: {
        select: { firstName: true, lastName: true },
      },
      _count: {
        select: { members: true, equipment: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <ProjectsContent
      userName={userName}
      isAdmin={isAdmin}
      isUserOnly={isUserOnly}
      showMyEquipment={showMyEquipment}
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        createdBy: { firstName: p.createdBy.firstName, lastName: p.createdBy.lastName },
        memberCount: p._count.members,
        equipmentCount: p._count.equipment,
      }))}
    />
  )
}
