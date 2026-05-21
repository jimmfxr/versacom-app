'use server'

import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { notifyMemberJoined } from '@/lib/notifications'

export async function joinProject(
  firstName: string,
  lastName: string,
  projectPin: string,
  position?: string,
  department?: string,
) {
  if (!firstName.trim() || !lastName.trim()) {
    return { error: 'First and last name are required' }
  }

  if (!projectPin || !/^\d{4}$/.test(projectPin)) {
    return { error: 'Project PIN must be 4 digits' }
  }

  // Find project by PIN
  const project = await prisma.project.findUnique({
    where: { pin: projectPin },
  })

  if (!project) {
    return { error: 'No project found with that PIN. Check the code and try again.' }
  }

  if (project.status === 'archived') {
    return { error: 'This project has been archived and is no longer accepting members.' }
  }

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      firstName: { equals: firstName.trim(), mode: 'insensitive' },
      lastName: { equals: lastName.trim(), mode: 'insensitive' },
    },
  })

  if (existingUser) {
    // Check if already a member
    const existingMembership = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: existingUser.id, projectId: project.id } },
    })

    if (existingMembership) {
      // If user has no PIN (forgot PIN flow), let them create a new one
      if (!existingUser.pin) {
        return {
          success: true,
          needsPin: true,
          projectName: project.name,
          firstName: existingUser.firstName,
          lastName: existingUser.lastName,
          projectId: project.id,
        }
      }
      return { error: 'You are already a member of this project. Go to login instead.' }
    }

    const dept = department?.trim() || null
    // Mirror the typed department onto the User row so it persists for
    // this person across future joins.
    if (dept) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { department: dept },
      })
    }
    // Add existing user to project
    await prisma.projectMember.create({
      data: {
        userId: existingUser.id,
        projectId: project.id,
        role: 'user',
        position: position?.trim() || null,
        department: dept,
      },
    })

    // Fire-and-forget: tell project admins someone returning joined.
    void notifyMemberJoined({
      projectId: project.id,
      memberName: `${existingUser.firstName} ${existingUser.lastName}`,
      role: 'user',
    })

    // If user has no PIN, send to create-PIN step
    if (!existingUser.pin) {
      return {
        success: true,
        needsPin: true,
        projectName: project.name,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        projectId: project.id,
      }
    }

    return {
      success: true,
      needsPin: false,
      projectName: project.name,
      message: `Welcome back! You've been added to ${project.name}.`,
    }
  }

  // New user — they need to create a personal PIN
  return {
    success: true,
    needsPin: true,
    projectName: project.name,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    projectId: project.id,
  }
}

export async function createPersonalPin(
  firstName: string,
  lastName: string,
  projectId: number,
  pin: string,
  position?: string,
  department?: string,
) {
  if (!pin || !/^\d{4}$/.test(pin)) {
    return { error: 'PIN must be 4 digits' }
  }

  const hashedPin = await bcrypt.hash(pin, 10)

  // Check if user already exists (forgot PIN flow — they exist but PIN is empty)
  const existingUser = await prisma.user.findFirst({
    where: {
      firstName: { equals: firstName, mode: 'insensitive' },
      lastName: { equals: lastName, mode: 'insensitive' },
    },
  })

  let userIdForSession: number
  let firstNameForSession: string
  let lastNameForSession: string

  if (existingUser) {
    // Update their PIN (forgot PIN recovery)
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        pin: hashedPin,
        failedAttempts: 0,
        lockedUntil: null,
        lastFailedAt: null,
      },
    })

    // Ensure membership exists
    const membership = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: existingUser.id, projectId } },
    })
    const dept = department?.trim() || null
    if (dept) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { department: dept },
      })
    }
    let didCreateMembership = false
    if (!membership) {
      await prisma.projectMember.create({
        data: {
          userId: existingUser.id,
          projectId,
          role: 'user',
          position: position?.trim() || null,
          department: dept,
        },
      })
      didCreateMembership = true
    }
    if (didCreateMembership) {
      void notifyMemberJoined({
        projectId,
        memberName: `${existingUser.firstName} ${existingUser.lastName}`,
        role: 'user',
      })
    }

    userIdForSession = existingUser.id
    firstNameForSession = existingUser.firstName
    lastNameForSession = existingUser.lastName
  } else {
    const dept = department?.trim() || null
    // Brand-new user — department is set on the User row for persistence
    // and copied to the membership for this show.
    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        pin: hashedPin,
        department: dept,
      },
    })

    await prisma.projectMember.create({
      data: {
        userId: user.id,
        projectId,
        role: 'user',
        position: position?.trim() || null,
        department: dept,
      },
    })

    void notifyMemberJoined({
      projectId,
      memberName: `${user.firstName} ${user.lastName}`,
      role: 'user',
    })

    userIdForSession = user.id
    firstNameForSession = user.firstName
    lastNameForSession = user.lastName
  }

  // Sign the user in straight away — same session cookie shape as the
  // /api/auth/login route — so the client can router.push('/') and skip
  // bouncing through the login screen with re-entered name + PIN.
  const memberships = await prisma.projectMember.findMany({
    where: {
      userId: userIdForSession,
      project: { status: 'active' },
    },
    include: { project: true },
  })

  function capitalize(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  }

  const sessionData = {
    user: {
      id: userIdForSession,
      firstName: capitalize(firstNameForSession),
      lastName: capitalize(lastNameForSession),
    },
    memberships: memberships.map((m) => ({
      id: m.id,
      role: m.role,
      position: m.position,
      project: { id: m.project.id, name: m.project.name },
    })),
  }

  const cookieStore = await cookies()
  cookieStore.set('session', JSON.stringify(sessionData), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours, matches login route
  })

  return { success: true }
}
