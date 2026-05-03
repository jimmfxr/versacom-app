import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { KioskClient } from './kiosk-client'

export const dynamic = 'force-dynamic'

export default async function KioskPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const projectId = parseInt(id, 10)
  if (!Number.isFinite(projectId)) notFound()

  // Auth: admin or manager on this project (or global admin).
  const membership = await prisma.projectMember.findFirst({
    where: { projectId, userId: session.user.id },
    select: { role: true },
  })
  const globalAdmin = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, role: 'admin' },
    select: { id: true },
  })
  const canRun =
    !!globalAdmin || membership?.role === 'admin' || membership?.role === 'manager'
  if (!canRun) redirect(`/projects/${projectId}`)

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, pin: true },
  })
  if (!project) notFound()

  // Pending members = joined the project but haven't finished first login.
  const pendingMembers = await prisma.projectMember.findMany({
    where: { projectId, user: { pin: '' } },
    select: {
      id: true,
      position: true,
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { id: 'desc' },
  })

  const pending = pendingMembers.map((m) => ({
    id: m.id,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
    position: m.position,
  }))

  return (
    <KioskClient
      projectId={project.id}
      projectName={project.name}
      pending={pending}
    />
  )
}
