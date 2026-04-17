import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * Returns the number of pending task cards for the current admin —
 * scoped to projects they're admin on, matching what /admin actually shows.
 *
 * Tasks = grouped change requests (one card per submitter + target member
 * combo) + active lockouts. Counted to match the cards on the page exactly.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ count: 0 })

  const adminProjectIds = session.memberships
    .filter((m) => m.role === 'admin')
    .map((m) => m.project.id)

  if (adminProjectIds.length === 0) return NextResponse.json({ count: 0 })

  const now = new Date()

  const [crGroups, lockoutCount] = await Promise.all([
    prisma.changeRequest.findMany({
      where: {
        status: { in: ['submitted', 'mgr_endorsed'] },
        projectId: { in: adminProjectIds },
      },
      select: { submittedById: true, targetMemberId: true },
      distinct: ['submittedById', 'targetMemberId'],
    }),
    prisma.user.count({
      where: {
        lockedUntil: { gt: now },
        memberships: { some: { projectId: { in: adminProjectIds } } },
      },
    }),
  ])

  return NextResponse.json({ count: crGroups.length + lockoutCount })
}
