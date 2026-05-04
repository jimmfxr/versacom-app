import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

const ASSIGNABLE_CATEGORIES = ['panels', 'wireless_bp', 'hardwire_bp']
const INFRA_CATEGORIES = ['switches', 'antennas', 'audio']

/**
 * Returns the number of actionable deployment tasks for the current user —
 * scoped to a SINGLE project (the one in the project dropdown), matching
 * what /tasks actually shows.
 *
 * Resolution: selectedProject cookie → first project alphabetically.
 *
 * Tasks = equipment with deployStatus='na' that's been planned, plus
 * 'done' items in projects with active return phase.
 *  - assignable types (panels/beltpacks) WITH a user assigned, OR
 *  - infra types (switches/antennas/audio) WITH a non-empty location
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ count: 0 })

  const memberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id, project: { status: 'active' } },
    select: {
      projectId: true,
      project: { select: { id: true, name: true, returnPhaseActive: true } },
    },
  })
  if (memberships.length === 0) return NextResponse.json({ count: 0 })

  // De-dup project list and sort by name so the fallback matches the
  // /tasks page's default project pick.
  const projectMap = new Map<number, { id: number; name: string; returnPhaseActive: boolean }>()
  for (const m of memberships) {
    if (!projectMap.has(m.projectId)) projectMap.set(m.projectId, m.project)
  }
  const sortedProjects = Array.from(projectMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  const cookieStore = await cookies()
  const cookieRaw = cookieStore.get('selectedProject')?.value
  const cookieId = cookieRaw ? parseInt(cookieRaw, 10) : NaN
  const scopedProjectId =
    Number.isFinite(cookieId) && projectMap.has(cookieId)
      ? cookieId
      : sortedProjects[0].id

  const scopedProject = projectMap.get(scopedProjectId)!
  const includeReturn = scopedProject.returnPhaseActive

  const rows = await prisma.equipment.findMany({
    where: {
      projectId: scopedProjectId,
      deployStatus: { in: ['na', 'done'] },
      OR: [
        { category: { in: ASSIGNABLE_CATEGORIES }, assignedToId: { not: null } },
        { category: { in: INFRA_CATEGORIES }, location: { not: null } },
      ],
    },
    select: { category: true, assignedToId: true, location: true, deployStatus: true },
  })

  const count = rows.filter((e) => {
    const planned =
      (ASSIGNABLE_CATEGORIES.includes(e.category) && e.assignedToId != null) ||
      (INFRA_CATEGORIES.includes(e.category) && !!(e.location && e.location.trim()))
    if (!planned) return false
    if (e.deployStatus === 'na') return true
    if (e.deployStatus === 'done') return includeReturn
    return false
  }).length

  return NextResponse.json({ count })
}
