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

const CATEGORY_PREFIXES: Record<string, string> = {
  panels: 'PNL',
  wireless_bp: 'WLBP',
  hardwire_bp: 'HWBP',
  switches: 'SW',
  antennas: 'ANT',
  audio: 'AUD',
}

export async function bulkCreateEquipment(
  projectId: number,
  category: string,
  hardwareType: string,
  quantity: number
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (!category || !CATEGORY_PREFIXES[category]) {
    return { error: 'Invalid category' }
  }
  if (quantity < 1 || quantity > 200) {
    return { error: 'Quantity must be between 1 and 200' }
  }

  // Find the highest existing number for this category in this project
  const existing = await prisma.equipment.findMany({
    where: { projectId, category },
    select: { name: true },
    orderBy: { id: 'desc' },
  })

  const prefix = CATEGORY_PREFIXES[category]
  let maxNum = 0
  for (const e of existing) {
    const match = e.name.match(new RegExp(`^${prefix}\\s+(\\d+)$`))
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > maxNum) maxNum = num
    }
  }

  const records = []
  for (let i = 1; i <= quantity; i++) {
    records.push({
      projectId,
      name: `${prefix} ${maxNum + i}`,
      category,
      hardwareType: hardwareType || null,
    })
  }

  await prisma.equipment.createMany({ data: records })

  revalidatePath(`/projects/${projectId}`)
  return { success: true, count: quantity }
}

export async function updateEquipment(
  projectId: number,
  equipmentId: number,
  data: {
    name?: string
    hardwareType?: string | null
    position?: string | null
    location?: string | null
    headsetType?: string | null
    ipAddress?: string | null
    deployStatus?: string
    assignedToId?: number | null
  }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.equipment.update({
    where: { id: equipmentId },
    data,
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function deleteEquipment(projectId: number, equipmentId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.equipment.delete({ where: { id: equipmentId } })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}
