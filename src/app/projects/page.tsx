import { prisma } from '@/lib/db'
import { ProjectsContent } from './projects-content'

export default async function ProjectsPage() {
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

  return (
    <ProjectsContent
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
