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

export async function createPickListItem(
  projectId: number,
  data: { name: string; type: string }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (!data.name.trim()) return { error: 'Name is required' }
  if (!['CONF', 'IFB', 'Audio_IO'].includes(data.type)) {
    return { error: 'Invalid function type' }
  }

  await prisma.pickListItem.create({
    data: {
      projectId,
      name: data.name.trim(),
      type: data.type,
    },
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function updatePickListItem(
  projectId: number,
  itemId: number,
  data: { name?: string; type?: string }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (data.name !== undefined && !data.name.trim()) {
    return { error: 'Name is required' }
  }
  if (data.type !== undefined && !['CONF', 'IFB', 'Audio_IO'].includes(data.type)) {
    return { error: 'Invalid function type' }
  }

  await prisma.pickListItem.update({
    where: { id: itemId },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
    },
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function deletePickListItem(projectId: number, itemId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.pickListItem.delete({ where: { id: itemId } })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}
