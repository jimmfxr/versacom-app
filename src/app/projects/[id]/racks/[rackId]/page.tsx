import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { RackDesigner } from './rack-designer'

export const dynamic = 'force-dynamic'

/**
 * Rack designer page. Lives at /projects/[id]/racks/[rackId].
 *
 * Server-fetches the RackTemplate, its slots (sorted by RU position,
 * grouped by side), and its loose items. Renders the RackDesigner
 * client component which owns the visualization + future drag/drop
 * interactions.
 *
 * Auth: caller must be a member of the project. Server checks the
 * project membership and 404s otherwise (no cross-project peeking).
 */
export default async function RackDesignerPage({
  params,
}: {
  params: Promise<{ id: string; rackId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id, rackId } = await params
  const projectId = parseInt(id, 10)
  const rackTemplateId = parseInt(rackId, 10)
  if (Number.isNaN(projectId) || Number.isNaN(rackTemplateId)) notFound()

  // Membership check — must be on this project's team. Same gating as
  // /projects/[id] itself.
  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId },
    select: { role: true },
  })
  if (!membership) notFound()

  const rack = await prisma.rackTemplate.findFirst({
    where: { id: rackTemplateId, projectId },
    select: {
      id: true,
      name: true,
      description: true,
      location: true,
      totalRU: true,
      dept: true,
      slots: {
        select: {
          id: true,
          ruPosition: true,
          ruSize: true,
          side: true,
          deviceType: true,
          label: true,
          color: true,
          equipmentId: true,
        },
        orderBy: [{ side: 'asc' }, { ruPosition: 'asc' }],
      },
      looseItems: {
        select: { id: true, deviceType: true, label: true, equipmentId: true },
        orderBy: { id: 'asc' },
      },
    },
  })
  if (!rack) notFound()

  // Project for the page header (name + id) AND the full list of the
  // current user's active projects so ProjectSwitcher can offer
  // jumping to any of them.
  const [project, userProjectMemberships] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    prisma.projectMember.findMany({
      where: { userId: session.user.id, project: { status: 'active' } },
      select: { project: { select: { id: true, name: true } } },
    }),
  ])
  if (!project) notFound()

  // De-dupe by project id (a user can hold multiple roles on one show).
  const seen = new Set<number>()
  const userProjects: Array<{ id: number; name: string }> = []
  for (const m of userProjectMemberships) {
    if (m.project && !seen.has(m.project.id)) {
      seen.add(m.project.id)
      userProjects.push(m.project)
    }
  }
  userProjects.sort((a, b) => a.name.localeCompare(b.name))

  const canEdit = membership.role === 'admin' || membership.role === 'manager'

  return (
    <RackDesigner
      project={project}
      userProjects={userProjects}
      rack={{
        id: rack.id,
        name: rack.name,
        description: rack.description,
        location: rack.location,
        totalRU: rack.totalRU,
        dept: rack.dept,
      }}
      slots={rack.slots}
      looseItems={rack.looseItems}
      canEdit={canEdit}
    />
  )
}
