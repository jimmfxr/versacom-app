import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { ProjectDetail } from './project-detail'

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) notFound()

  const project = await prisma.project.findUnique({
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
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { id: 'asc' },
      },
    },
  })

  if (!project) notFound()

  return (
    <ProjectDetail
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
        })),
      }}
    />
  )
}
