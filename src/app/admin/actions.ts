'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'

export async function unlockUser(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } })

  if (!user) {
    return { error: 'User not found' }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { failedAttempts: 0, lockedUntil: null, lastFailedAt: null },
  })

  revalidatePath('/admin')
  revalidatePath('/admin/lockouts')
  return { success: true, message: `${user.firstName} ${user.lastName} has been unlocked` }
}
