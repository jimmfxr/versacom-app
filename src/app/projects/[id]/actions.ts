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

export async function updateProject(projectId: number, formData: FormData) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const name = (formData.get('name') as string)?.trim()
  const status = formData.get('status') as string
  const managerId = formData.get('managerId') as string

  if (!name || name.length === 0) {
    return { error: 'Project name is required' }
  }
  if (name.length > 100) {
    return { error: 'Project name must be 100 characters or less' }
  }
  if (status !== 'active' && status !== 'archived') {
    return { error: 'Invalid status' }
  }

  // Check for duplicate name (excluding this project)
  const existing = await prisma.project.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      id: { not: projectId },
    },
  })
  if (existing) {
    return { error: 'A project with that name already exists' }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { name, status },
  })

  // Update manager role if set
  if (managerId) {
    const mgrId = parseInt(managerId, 10)
    if (!isNaN(mgrId)) {
      // Remove manager role from current manager(s)
      await prisma.projectMember.updateMany({
        where: { projectId, role: 'manager' },
        data: { role: 'crew' },
      })
      // Set new manager
      await prisma.projectMember.updateMany({
        where: { projectId, userId: mgrId },
        data: { role: 'manager' },
      })
    }
  }

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/projects')
  return { success: true }
}

export async function removeMember(projectId: number, memberId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.projectMember.delete({
    where: { id: memberId },
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function deleteProject(projectId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.projectMember.deleteMany({ where: { projectId } })
  await prisma.project.delete({ where: { id: projectId } })

  revalidatePath('/projects')
  return { success: true }
}
