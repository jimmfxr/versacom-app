// Per-user notification preference lookup + mutation. The settings UI
// reads + writes through these helpers; safeSend() calls
// filterRecipientsByPref() before persisting/pushing so a user who has
// opted out of a type doesn't get a history row OR a push for it. Other
// recipients on the same notification are unaffected — opt-outs are
// individual.

import { prisma } from '@/lib/db'
import type { NotificationType } from '@/lib/notification-types'

/**
 * Remove userIds whose NotificationPreference row for `type` is
 * `enabled: false`. Missing row = opted-in (default). Returns the
 * filtered list, preserving order.
 */
export async function filterRecipientsByPref(
  userIds: number[],
  type: NotificationType,
): Promise<number[]> {
  if (userIds.length === 0) return userIds
  const disabled = await prisma.notificationPreference.findMany({
    where: { type, userId: { in: userIds }, enabled: false },
    select: { userId: true },
  })
  if (disabled.length === 0) return userIds
  const off = new Set(disabled.map((r) => r.userId))
  return userIds.filter((id) => !off.has(id))
}

/**
 * Fetch every preference row the user has saved. Missing types fall
 * back to enabled — callers should merge against the full catalog.
 */
export async function getUserPrefs(
  userId: number,
): Promise<Record<string, boolean>> {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { type: true, enabled: true },
  })
  const out: Record<string, boolean> = {}
  for (const r of rows) out[r.type] = r.enabled
  return out
}

/**
 * Upsert one user/type preference. Used by the toggle on /notifications.
 */
export async function setUserPref(
  userId: number,
  type: NotificationType,
  enabled: boolean,
): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    create: { userId, type, enabled },
    update: { enabled },
  })
}
