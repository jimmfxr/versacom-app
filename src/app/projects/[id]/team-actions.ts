'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'

async function getSession() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')
  if (!sessionCookie?.value) return null
  try {
    return JSON.parse(sessionCookie.value) as { user: { id: number } }
  } catch {
    return null
  }
}

export async function createMember(
  projectId: number,
  data: { firstName: string; lastName: string; position?: string; role: string }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (!data.firstName.trim() || !data.lastName.trim()) {
    return { error: 'First and last name are required' }
  }

  if (!['admin', 'manager', 'crew', 'user'].includes(data.role)) {
    return { error: 'Invalid role' }
  }

  // Check if a user with this name already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      firstName: { equals: data.firstName.trim(), mode: 'insensitive' },
      lastName: { equals: data.lastName.trim(), mode: 'insensitive' },
    },
  })

  if (existingUser) {
    // Check if already a member of this project
    const existingMember = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: existingUser.id, projectId } },
    })
    if (existingMember) {
      return { error: `${data.firstName.trim()} ${data.lastName.trim()} is already on this project` }
    }

    // Add existing user to project
    await prisma.projectMember.create({
      data: {
        userId: existingUser.id,
        projectId,
        role: data.role,
        position: data.position?.trim() || null,
      },
    })
  } else {
    // Create new user (empty PIN — they set it when they join/login)
    const user = await prisma.user.create({
      data: {
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        pin: '',
      },
    })

    await prisma.projectMember.create({
      data: {
        userId: user.id,
        projectId,
        role: data.role,
        position: data.position?.trim() || null,
      },
    })
  }

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function updateMember(
  projectId: number,
  memberId: number,
  data: { firstName?: string; lastName?: string; position?: string | null; role?: string }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const member = await prisma.projectMember.findUnique({
    where: { id: memberId },
    include: { user: true },
  })
  if (!member) return { error: 'Member not found' }

  // Update user name if changed
  if (data.firstName !== undefined || data.lastName !== undefined) {
    await prisma.user.update({
      where: { id: member.userId },
      data: {
        ...(data.firstName !== undefined ? { firstName: data.firstName.trim() } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName.trim() } : {}),
      },
    })
  }

  // Update member fields
  await prisma.projectMember.update({
    where: { id: memberId },
    data: {
      ...(data.position !== undefined ? { position: data.position || null } : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
    },
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function deleteMember(projectId: number, memberId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  // Unassign any equipment assigned to this member
  await prisma.equipment.updateMany({
    where: { assignedToId: memberId },
    data: { assignedToId: null },
  })

  await prisma.projectMember.delete({ where: { id: memberId } })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}
