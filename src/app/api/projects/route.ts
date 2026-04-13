import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  const projects = await prisma.project.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      createdBy: {
        select: { firstName: true, lastName: true },
      },
      members: {
        select: {
          id: true,
          role: true,
          position: true,
          user: { select: { firstName: true, lastName: true } },
        },
      },
      _count: {
        select: { equipment: true, pickListItems: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(projects)
}
