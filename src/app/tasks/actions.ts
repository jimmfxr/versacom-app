'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { notifyDeployStatusChanged } from '@/lib/notifications'

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
  void notifyDeployStatusChanged({
    equipmentId,
    newStatus: 'deployed',
    actorUserId: session.user.id,
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

/** Crew action: mark a "done" piece of equipment returned (back in case). */
export async function markReturned(equipmentId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await userBelongsToProject(session.user.id, equipmentId))) {
    return { error: 'Not authorized' }
  }
  await prisma.equipment.update({
    where: { id: equipmentId },
    data: { deployStatus: 'returned' },
  })
  void notifyDeployStatusChanged({
    equipmentId,
    newStatus: 'returned',
    actorUserId: session.user.id,
  })
  revalidatePath('/tasks')
  revalidatePath('/')
  revalidatePath('/my-equipment')
  return { success: true }
}

/** Reverts a markReturned within the 10-second undo window. */
export async function undoReturned(equipmentId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await userBelongsToProject(session.user.id, equipmentId))) {
    return { error: 'Not authorized' }
  }
  await prisma.equipment.update({
    where: { id: equipmentId },
    data: { deployStatus: 'done' },
  })
  revalidatePath('/tasks')
  revalidatePath('/')
  revalidatePath('/my-equipment')
  return { success: true }
}
