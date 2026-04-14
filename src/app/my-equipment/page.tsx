import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { MyEquipmentContent } from './my-equipment-content'

export default async function MyEquipmentPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const userName = `${session.user.firstName} ${session.user.lastName}`

  // Get all project memberships for this user
  const memberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      position: true,
      project: { select: { id: true, name: true } },
    },
  })

  const memberIds = memberships.map((m) => m.id)

  // Get all equipment assigned to this user across all projects
  const equipment = await prisma.equipment.findMany({
    where: { assignedToId: { in: memberIds } },
    select: {
      id: true,
      name: true,
      category: true,
      hardwareType: true,
      location: true,
      headsetType: true,
      ipAddress: true,
      deployStatus: true,
      projectId: true,
    },
    orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
  })

  // Map projectId to project name
  const projectMap: Record<number, string> = {}
  for (const m of memberships) {
    projectMap[m.project.id] = m.project.name
  }

  const items = equipment.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    hardwareType: e.hardwareType,
    location: e.location,
    headsetType: e.headsetType,
    ipAddress: e.ipAddress,
    deployStatus: e.deployStatus,
    projectName: projectMap[e.projectId] || '',
  }))

  return <MyEquipmentContent userName={userName} equipment={items} />
}
