import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'

const MAX_ATTEMPTS = 10
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

export async function POST(request: NextRequest) {
  const { firstName, lastName, pin } = await request.json()

  if (!firstName || !lastName || typeof firstName !== 'string' || typeof lastName !== 'string') {
    return NextResponse.json(
      { error: 'First name and last name are required' },
      { status: 400 }
    )
  }

  if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return NextResponse.json(
      { error: 'PIN must be 4 digits' },
      { status: 400 }
    )
  }

  // Look up user by name (case-insensitive)
  const user = await prisma.user.findFirst({
    where: {
      firstName: { equals: firstName.trim(), mode: 'insensitive' },
      lastName: { equals: lastName.trim(), mode: 'insensitive' },
    },
  })

  if (!user) {
    return NextResponse.json(
      { error: 'No account found with that name. Check your spelling or request access.' },
      { status: 401 }
    )
  }

  // Check if user is currently locked out
  if (user.lockedUntil) {
    const lockExpiry = new Date(user.lockedUntil)
    if (lockExpiry > new Date()) {
      const remaining = Math.ceil((lockExpiry.getTime() - Date.now()) / 60000)
      return NextResponse.json(
        {
          error: 'locked',
          message: 'Account temporarily locked',
          minutesRemaining: remaining,
        },
        { status: 423 }
      )
    }
    // Lockout expired — clear it
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null, lastFailedAt: null },
    })
    user.failedAttempts = 0
  }

  // Verify PIN
  const pinMatch = await bcrypt.compare(pin, user.pin)

  if (!pinMatch) {
    const attempts = user.failedAttempts + 1

    if (attempts >= MAX_ATTEMPTS) {
      // Lock the account
      const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS)
      await prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: attempts, lockedUntil, lastFailedAt: new Date() },
      })
      const remaining = Math.ceil(LOCKOUT_DURATION_MS / 60000)
      return NextResponse.json(
        {
          error: 'locked',
          message: 'Account temporarily locked',
          minutesRemaining: remaining,
        },
        { status: 423 }
      )
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: attempts, lastFailedAt: new Date() },
    })

    const attemptsLeft = MAX_ATTEMPTS - attempts
    return NextResponse.json(
      { error: `Incorrect PIN. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.` },
      { status: 401 }
    )
  }

  // Successful login — reset counters
  const matchedUser = user
  await prisma.user.update({
    where: { id: matchedUser.id },
    data: { failedAttempts: 0, lockedUntil: null, lastFailedAt: null },
  })

  // Get active project memberships only
  const memberships = await prisma.projectMember.findMany({
    where: {
      userId: matchedUser.id,
      project: { status: 'active' },
    },
    include: { project: true },
  })

  if (memberships.length === 0) {
    return NextResponse.json(
      { error: 'You have no active projects. Join a project first.' },
      { status: 401 }
    )
  }

  const sessionData = {
    user: {
      id: matchedUser.id,
      firstName: matchedUser.firstName,
      lastName: matchedUser.lastName,
    },
    memberships: memberships.map((m) => ({
      id: m.id,
      role: m.role,
      position: m.position,
      project: { id: m.project.id, name: m.project.name },
    })),
  }

  const response = NextResponse.json(sessionData)

  // Set session cookie
  response.cookies.set('session', JSON.stringify(sessionData), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  })

  return response
}
