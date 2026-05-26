import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * Pending check-ins JSON endpoint for the kiosk's lightweight polling
 * loop. The kiosk used to call router.refresh() every 4s, which
 * re-renders the entire Server Component tree (the page + every
 * client component prop) and causes a visible glitch — comboboxes
 * resetting focus, the pending list briefly flickering, etc.
 *
 * This route returns only the data the kiosk client actually needs
 * to update incrementally (pending list + suggestion lists) as JSON,
 * so the client can diff into local state without remounting.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id } = await params
  const projectId = Number.parseInt(id, 10)
  if (!Number.isFinite(projectId)) {
    return NextResponse.json({ error: 'bad-id' }, { status: 400 })
  }

  // Same auth gate as the kiosk page itself: admin/manager on this
  // project, or global admin (admin on any project).
  const [membership, globalAdmin] = await Promise.all([
    prisma.projectMember.findFirst({
      where: { projectId, userId: session.user.id },
      select: { role: true },
    }),
    prisma.projectMember.findFirst({
      where: { userId: session.user.id, role: 'admin' },
      select: { id: true },
    }),
  ])
  const canRun =
    !!globalAdmin || membership?.role === 'admin' || membership?.role === 'manager'
  if (!canRun) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const pendingMembers = await prisma.projectMember.findMany({
    where: { projectId, user: { pin: '' } },
    select: {
      id: true,
      position: true,
      department: true,
      user: { select: { firstName: true, lastName: true } },
      equipment: { select: { name: true } },
    },
  })

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  })

  const pending = pendingMembers
    .map((m) => ({
      id: m.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      position: m.position,
      department: m.department,
      equipmentNames: m.equipment
        .map((e) => e.name)
        .sort((a, b) => collator.compare(a, b)),
    }))
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

  const [positionRows, departmentRows] = await Promise.all([
    prisma.projectMember.findMany({
      where: { projectId, position: { not: null } },
      select: { position: true },
      distinct: ['position'],
    }),
    prisma.projectMember.findMany({
      where: { projectId, department: { not: null } },
      select: { department: true },
      distinct: ['department'],
    }),
  ])

  const positionSuggestions = positionRows
    .map((r) => r.position?.trim() ?? '')
    .filter(Boolean)
    .sort((a, b) => collator.compare(a, b))

  const departmentSuggestions = departmentRows
    .map((r) => r.department?.trim() ?? '')
    .filter(Boolean)
    .sort((a, b) => collator.compare(a, b))

  return NextResponse.json({ pending, positionSuggestions, departmentSuggestions })
}
