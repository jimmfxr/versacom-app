import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { capitalizeName } from '@/lib/format-name'
import { LockoutsClient } from './lockouts-client'

export const dynamic = 'force-dynamic'

export default async function LockoutsPage() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      failedAttempts: true,
      lockedUntil: true,
      lastFailedAt: true,
      memberships: {
        select: {
          role: true,
          project: { select: { name: true } },
        },
        take: 1,
      },
    },
    orderBy: { firstName: 'asc' },
  })

  const serialized = users.map((u) => ({
    id: u.id,
    firstName: capitalizeName(u.firstName),
    lastName: capitalizeName(u.lastName),
    failedAttempts: u.failedAttempts,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    lastFailedAt: u.lastFailedAt?.toISOString() ?? null,
    projectName: u.memberships[0]?.project.name ?? null,
    role: u.memberships[0]?.role ?? null,
  }))

  const session = await getSession()
  const userName = session ? `${session.user.firstName} ${session.user.lastName}` : undefined

  const isAdmin = session?.memberships.some((m) => m.role === 'admin') ?? false

  return <LockoutsClient users={serialized} userName={userName} isAdmin={isAdmin} />
}
