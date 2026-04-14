import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { ProjectsContent } from './projects-content'

export default async function ProjectsPage() {
  const session = await getSession()
  const userName = session ? `${session.user.firstName} ${session.user.lastName}` : undefined

  const projects = await prisma.project.findMany({
    where: { status: 'active' },
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

  const isAdmin = session?.memberships.some((m) => m.role === 'admin') ?? false
  const isUserOnly = session ? session.memberships.every((m) => m.role === 'user') : false

  return (
    <ProjectsContent
      userName={userName}
      isAdmin={isAdmin}
      isUserOnly={isUserOnly}
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        createdBy: p.createdBy,
        memberCount: p._count.members,
        equipmentCount: p._count.equipment,
      }))}
    />
  )
}
