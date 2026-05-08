import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * Returns the number of pending task cards for the current admin —
 * scoped to a SINGLE project (the one the user is filtering to via the
 * project dropdown), matching what /admin actually shows.
 *
 * Resolution: selectedProject cookie → first admin project alphabetically.
 * Keeps the badge in sync with the page's default filter so the count
 * never disagrees with what the user sees on screen.
 *
 * Tasks = grouped change requests (one card per submitter + target member
 * + equipment combo) + active lockouts. Equipment is in the group key so
 * a user editing two devices on the same show produces two cards, not
 * one — matches /admin's grouping exactly.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ count: 0 })

  const adminProjects = session.memberships
    .filter((m) => m.role === 'admin')
    .map((m) => m.project)
  if (adminProjects.length === 0) return NextResponse.json({ count: 0 })

  // De-dup (a user can have multiple memberships per project) and sort so
  // the fallback matches /admin's default-project pick.
  const projectMap = new Map<number, { id: number; name: string }>()
  for (const p of adminProjects) if (!projectMap.has(p.id)) projectMap.set(p.id, p)
  const sortedAdminProjects = Array.from(projectMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  const cookieStore = await cookies()
  const cookieRaw = cookieStore.get('selectedProject')?.value
  const cookieId = cookieRaw ? parseInt(cookieRaw, 10) : NaN
  const scopedProjectId =
    Number.isFinite(cookieId) && projectMap.has(cookieId)
      ? cookieId
      : sortedAdminProjects[0].id

  const now = new Date()

  const [crGroups, lockoutCount] = await Promise.all([
    prisma.changeRequest.findMany({
      where: {
        status: { in: ['submitted', 'mgr_endorsed'] },
        projectId: scopedProjectId,
      },
      select: { submittedById: true, targetMemberId: true, equipmentId: true },
      distinct: ['submittedById', 'targetMemberId', 'equipmentId'],
    }),
    prisma.user.count({
      where: {
        lockedUntil: { gt: now },
        memberships: { some: { projectId: scopedProjectId } },
      },
    }),
  ])

  return NextResponse.json({ count: crGroups.length + lockoutCount })
}
