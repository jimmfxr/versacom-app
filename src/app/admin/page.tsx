import { prisma } from '@/lib/db'
import { TasksClient } from './tasks-client'

export default async function TasksPage() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      failedAttempts: true,
      lockedUntil: true,
      lastFailedAt: true,
    },
    orderBy: { firstName: 'asc' },
  })

  const now = new Date()
  const tasks = users
    .filter((u) => u.lockedUntil && new Date(u.lockedUntil) > now)
    .map((u) => ({
      id: `lockout-${u.id}`,
      type: 'lockout' as const,
      userId: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      failedAttempts: u.failedAttempts,
      status: 'locked' as const,
      lockedUntil: u.lockedUntil?.toISOString() ?? null,
      lastFailedAt: u.lastFailedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => new Date(b.lockedUntil!).getTime() - new Date(a.lockedUntil!).getTime())

  return <TasksClient tasks={tasks} />
}
