'use server'

import { prisma } from '@/lib/db'

export async function resetPin(firstName: string, lastName: string) {
  if (!firstName.trim() || !lastName.trim()) {
    return { error: 'First and last name are required' }
  }

  const user = await prisma.user.findFirst({
    where: {
      firstName: { equals: firstName.trim(), mode: 'insensitive' },
      lastName: { equals: lastName.trim(), mode: 'insensitive' },
    },
  })

  if (!user) {
    return { error: 'No account found with that name. Check your spelling and try again.' }
  }

  // Wipe their PIN and reset lockout state
  await prisma.user.update({
    where: { id: user.id },
    data: {
      pin: '',
      failedAttempts: 0,
      lockedUntil: null,
      lastFailedAt: null,
    },
  })

  return { success: true }
}
