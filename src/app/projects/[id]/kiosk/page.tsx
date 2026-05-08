import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { capitalizeName } from '@/lib/format-name'
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
      equipment: { select: { name: true } },
    },
  })

  // Natural-number sort so "100A" comes before "100B" before "200A".
  // Plain alphabetical would put "100B" right after "100A". Same collator
  // also applied to first/last name as a tiebreaker.
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const pending = pendingMembers
    .map((m) => ({
      id: m.id,
      firstName: capitalizeName(m.user.firstName),
      lastName: capitalizeName(m.user.lastName),
      position: m.position,
      // Sort equipment names naturally so "100A, 100B, 200A" reads in order.
      equipmentNames: m.equipment
        .map((e) => e.name)
        .sort((a, b) => collator.compare(a, b)),
    }))
    // Primary sort: first equipment ID (natural collation). Members
    // without equipment fall to the bottom, then tiebreak by name.
    .sort((a, b) => {
      const aId = a.equipmentNames[0] ?? ''
      const bId = b.equipmentNames[0] ?? ''
      if (aId && !bId) return -1
      if (!aId && bId) return 1
      if (aId && bId) {
        const byId = collator.compare(aId, bId)
        if (byId !== 0) return byId
      }
      const byFirst = collator.compare(a.firstName, b.firstName)
      if (byFirst !== 0) return byFirst
      return collator.compare(a.lastName, b.lastName)
    })

  // Distinct positions already used on this project — fed to the
  // Add-Crew form's position combobox as suggestions (FOH, SL, SR,
  // etc.) so kiosk operators can pick from existing positions
  // instead of typing freehand every time.
  const positionRows = await prisma.projectMember.findMany({
    where: { projectId, position: { not: null } },
    select: { position: true },
    distinct: ['position'],
  })
  const positionSuggestions = positionRows
    .map((r) => r.position?.trim() ?? '')
    .filter(Boolean)
    .sort((a, b) => collator.compare(a, b))

  return (
    <KioskClient
      projectId={project.id}
      projectName={project.name}
      pending={pending}
      positionSuggestions={positionSuggestions}
    />
  )
}
