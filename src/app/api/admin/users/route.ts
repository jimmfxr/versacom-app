import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      failedAttempts: true,
      lockedUntil: true,
      lastFailedAt: true,
      createdAt: true,
      memberships: {
        select: {
          role: true,
          project: { select: { name: true } },
        },
      },
    },
    orderBy: { firstName: 'asc' },
  })

  return NextResponse.json(users)
}
