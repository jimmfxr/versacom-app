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

/**
 * Crew action: mark a piece of equipment returned (back in case).
 * Accepts items in any prior state since the Return queue now
 * includes na/deployed/done/not-needed alongside done — anything
 * that needs accounting at end of show. Returns the previous
 * deployStatus so the client can pass it to undoReturned and
 * restore the right state instead of always landing on 'done'.
 */
export async function markReturned(equipmentId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await userBelongsToProject(session.user.id, equipmentId))) {
    return { error: 'Not authorized' }
  }
  const before = await prisma.equipment.findUnique({
    where: { id: equipmentId },
    select: { deployStatus: true },
  })
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
  return { success: true, previousStatus: before?.deployStatus ?? 'done' }
}

/**
 * Reverts a markReturned within the 10-second undo window. Restores
 * to the prior status the client captured at mark time (passed
 * back via markReturned's `previousStatus`). Falls back to 'done'
 * if no previous is provided so existing callers stay compatible.
 */
export async function undoReturned(
  equipmentId: number,
  previousStatus: string = 'done',
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await userBelongsToProject(session.user.id, equipmentId))) {
    return { error: 'Not authorized' }
  }
  await prisma.equipment.update({
    where: { id: equipmentId },
    data: { deployStatus: previousStatus },
  })
  revalidatePath('/tasks')
  revalidatePath('/')
  revalidatePath('/my-equipment')
  return { success: true }
}
