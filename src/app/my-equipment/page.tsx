import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { MyEquipmentContent } from './my-equipment-content'

export default async function MyEquipmentPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const userName = `${session.user.firstName} ${session.user.lastName}`
  const isUserOnly = session.memberships.every((m) => m.role === 'user')
  const isAdmin = session.memberships.some((m) => m.role === 'admin')

  // Get all project memberships for this user
  const memberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      role: true,
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
  const roleMap: Record<number, string> = {}
  for (const m of memberships) {
    projectMap[m.project.id] = m.project.name
    roleMap[m.project.id] = m.role
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
    projectId: e.projectId,
    projectName: projectMap[e.projectId] || '',
    userRole: roleMap[e.projectId] || 'user',
  }))

  return <MyEquipmentContent userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} equipment={items} />
}
