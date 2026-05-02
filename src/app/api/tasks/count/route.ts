import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

const ASSIGNABLE_CATEGORIES = ['panels', 'wireless_bp', 'hardwire_bp']
const INFRA_CATEGORIES = ['switches', 'antennas', 'audio']

/**
 * Returns the number of actionable deployment tasks for the current user —
 * scoped to projects they belong to, matching what /tasks renders.
 *
 * Tasks = equipment with deployStatus='na' that's been planned, i.e.
 *  - assignable types (panels/beltpacks) WITH a user assigned, OR
 *  - infra types (switches/antennas/audio) WITH a non-empty location
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ count: 0 })

  const memberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id, project: { status: 'active' } },
    select: { projectId: true },
  })
  const projectIds = Array.from(new Set(memberships.map((m) => m.projectId)))
  if (projectIds.length === 0) return NextResponse.json({ count: 0 })

  // Pull only the rows we need to verify the location-non-empty condition,
  // since Prisma can't easily express "string is not empty/whitespace" without raw SQL.
  const rows = await prisma.equipment.findMany({
    where: {
      projectId: { in: projectIds },
      deployStatus: 'na',
      OR: [
        { category: { in: ASSIGNABLE_CATEGORIES }, assignedToId: { not: null } },
        { category: { in: INFRA_CATEGORIES }, location: { not: null } },
      ],
    },
    select: { category: true, assignedToId: true, location: true },
  })

  const count = rows.filter((e) => {
    if (ASSIGNABLE_CATEGORIES.includes(e.category)) return e.assignedToId != null
    if (INFRA_CATEGORIES.includes(e.category)) return !!(e.location && e.location.trim())
    return false
  }).length

  return NextResponse.json({ count })
}
