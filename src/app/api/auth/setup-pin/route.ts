import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { capitalizeName } from '@/lib/format-name'

export async function POST(request: NextRequest) {
  const { firstName, lastName, projectId, pin } = await request.json()

  if (!firstName || !lastName || typeof firstName !== 'string' || typeof lastName !== 'string') {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
  }

  if (!projectId || typeof projectId !== 'number') {
    return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
  }

  // Find user by name
  const user = await prisma.user.findFirst({
    where: {
      firstName: { equals: firstName.trim(), mode: 'insensitive' },
      lastName: { equals: lastName.trim(), mode: 'insensitive' },
    },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Only allow if PIN is still empty (prevents overwriting an existing PIN)
  if (user.pin) {
    return NextResponse.json({ error: 'PIN is already set. Use the login page.' }, { status: 409 })
  }

  // Verify user is actually a member of this project
  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: user.id, projectId } },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this project' }, { status: 403 })
  }

  // Hash and save the new PIN, clear any lockout state
  const hashedPin = await bcrypt.hash(pin, 10)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      pin: hashedPin,
      failedAttempts: 0,
      lockedUntil: null,
      lastFailedAt: null,
    },
  })

  // Auto-login: build session and set cookie (same logic as login route)
  const memberships = await prisma.projectMember.findMany({
    where: { userId: user.id, project: { status: 'active' } },
    include: { project: true },
  })

  const sessionData = {
    user: {
      id: user.id,
      firstName: capitalizeName(user.firstName),
      lastName: capitalizeName(user.lastName),
    },
    memberships: memberships.map((m) => ({
      id: m.id,
      role: m.role,
      position: m.position,
      project: { id: m.project.id, name: m.project.name },
    })),
  }

  const response = NextResponse.json(sessionData)

  response.cookies.set('session', JSON.stringify(sessionData), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  })

  return response
}
