'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

/** Flip a single notification's read flag to true. Bell links use this
 *  via the page's row-click handler. The row server-renders with the
 *  next refresh — no client-side optimistic state needed. */
export async function markNotificationRead(notificationId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  // Guard: a user can only mark THEIR OWN notifications. Anyone
  // forging a notificationId for someone else's row gets a no-op
  // because the where clause includes their userId.
  await prisma.notification.updateMany({
    where: { id: notificationId, userId: session.user.id },
    data: { read: true },
  })

  revalidatePath('/notifications')
  return { success: true }
}

/** Bulk: flip every unread notification for the current user to read.
 *  Wired to the "Mark all read" button at the top of /notifications. */
export async function markAllNotificationsRead() {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.notification.updateMany({
    where: { userId: session.user.id, read: false },
    data: { read: true },
  })

  revalidatePath('/notifications')
  return { success: true }
}

/** Clear (hard delete) every notification for the current user. Used by
 *  the "Clear all" button. Read OR unread — both go. */
export async function clearAllNotifications() {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.notification.deleteMany({
    where: { userId: session.user.id },
  })

  revalidatePath('/notifications')
  return { success: true }
}
