'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'

const VALID_TYPES = ['CONF', 'IFB', 'Audio_IO', 'GRP'] as const
type ValidType = (typeof VALID_TYPES)[number]

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

/** Format a sequential number into the type-specific human-readable code. */
function formatCode(type: ValidType, n: number): string {
  switch (type) {
    case 'CONF':
      return 'C' + String(n).padStart(3, '0')
    case 'IFB':
      return 'IF' + String(n).padStart(2, '0')
    case 'GRP':
      return 'G' + String(n).padStart(3, '0')
    case 'Audio_IO':
      return 'A' + String(n).padStart(3, '0')
  }
}

/** Find the next unused sequential number for a given type within a project. */
async function nextCode(projectId: number, type: ValidType): Promise<string> {
  const existing = await prisma.pickListItem.findMany({
    where: { projectId, type },
    select: { code: true },
  })
  // Parse trailing digits off existing codes, find max, increment
  let max = 0
  for (const { code } of existing) {
    if (!code) continue
    const match = code.match(/(\d+)$/)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n > max) max = n
    }
  }
  return formatCode(type, max + 1)
}

export async function createPickListItem(
  projectId: number,
  data: { name: string; type: string; code?: string }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (!data.name.trim()) return { error: 'Name is required' }
  if (!VALID_TYPES.includes(data.type as ValidType)) {
    return { error: 'Invalid function type' }
  }

  const type = data.type as ValidType
  const code = data.code?.trim() || (await nextCode(projectId, type))

  await prisma.pickListItem.create({
    data: {
      projectId,
      code,
      name: data.name.trim(),
      type,
    },
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function updatePickListItem(
  projectId: number,
  itemId: number,
  data: { name?: string; type?: string; code?: string | null }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (data.name !== undefined && !data.name.trim()) {
    return { error: 'Name is required' }
  }
  if (data.type !== undefined && !VALID_TYPES.includes(data.type as ValidType)) {
    return { error: 'Invalid function type' }
  }

  await prisma.pickListItem.update({
    where: { id: itemId },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.code !== undefined
        ? { code: data.code === null ? null : data.code.trim() || null }
        : {}),
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
