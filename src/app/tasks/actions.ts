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

/** Confirms the calling user belongs to the project that owns this equipment. */
async function userBelongsToProject(userId: number, equipmentId: number) {
  const eq = await prisma.equipment.findUnique({
    where: { id: equipmentId },
    select: { projectId: true },
  })
  if (!eq) return false
  const membership = await prisma.projectMember.findFirst({
    where: { userId, projectId: eq.projectId },
    select: { id: true },
  })
  return !!membership
}

/** Crew action: mark a piece of equipment deployed from the Tasks page. */
export async function markDeployed(equipmentId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await userBelongsToProject(session.user.id, equipmentId))) {
    return { error: 'Not authorized' }
  }
  await prisma.equipment.update({
    where: { id: equipmentId },
    data: { deployStatus: 'deployed' },
  })
  revalidatePath('/tasks')
  revalidatePath('/')
  revalidatePath('/my-equipment')
  return { success: true }
}

/** Reverts a markDeployed within the 10-second undo window. */
export async function undoDeployed(equipmentId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await userBelongsToProject(session.user.id, equipmentId))) {
    return { error: 'Not authorized' }
  }
  await prisma.equipment.update({
    where: { id: equipmentId },
    data: { deployStatus: 'na' },
  })
  revalidatePath('/tasks')
  revalidatePath('/')
  revalidatePath('/my-equipment')
  return { success: true }
}
