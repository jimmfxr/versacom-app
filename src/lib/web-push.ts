// Web Push fan-out helper.
//
// Reads VAPID credentials from env (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
// `VAPID_SUBJECT`) once at import time, then exposes a small `sendPush`
// API that:
//
//   1. Sends a notification to a list of `PushSubscription` rows in
//      parallel.
//   2. Cleans up subscriptions the push service reports as gone (HTTP
//      404 / 410) so we don't keep retrying dead endpoints.
//
// All callers should use Node runtime — `web-push` depends on Node's
// `crypto` and won't run on Vercel Edge.

import webpush from 'web-push'
import { prisma } from '@/lib/db'

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
// VAPID spec requires a contact identifier for the application server —
// either a `mailto:` URL or an `https://` URL of the operator. Defaults
// to a `mailto:` placeholder so the library doesn't crash if env is
// unset; real deploys should override.
const SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:noreply@example.com'

let configured = false
function ensureConfigured(): boolean {
  if (configured) return true
  if (!PUBLIC_KEY || !PRIVATE_KEY) return false
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY)
  configured = true
  return true
}

export type PushPayload = {
  /** Headline shown bold in the OS notification. */
  title: string
  /** Body line below the title. */
  body: string
  /** URL to open when the notification is clicked. Relative or absolute. */
  url?: string
  /** Optional dedup key — same `tag` collapses repeat notifications. */
  tag?: string
}

type StoredSubscription = {
  id: number
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Fan-out a payload to every subscription belonging to `userIds`.
 * Cleans up subscriptions that report 404/410 (gone). Failures are
 * swallowed otherwise so a single bad endpoint doesn't take down the
 * whole batch.
 */
export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<void> {
  if (userIds.length === 0) return
  if (!ensureConfigured()) {
    console.warn('[web-push] VAPID env not set — skipping push fanout')
    return
  }
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  })
  if (subs.length === 0) return

  const json = JSON.stringify(payload)
  const goneIds: number[] = []

  await Promise.all(
    subs.map((s: StoredSubscription) =>
      webpush
        .sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          json,
        )
        .catch((err: unknown) => {
          // 404 / 410 means the browser has revoked or uninstalled — drop
          // the row so we stop trying. Other errors (network, payload too
          // large, etc.) are logged but kept; user may try again.
          const code = typeof err === 'object' && err !== null && 'statusCode' in err
            ? Number((err as { statusCode?: unknown }).statusCode)
            : null
          if (code === 404 || code === 410) {
            goneIds.push(s.id)
          } else {
            console.warn('[web-push] send failed', code, err)
          }
        }),
    ),
  )

  if (goneIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: goneIds } } }).catch(() => {})
  }
}

/** Public VAPID key for the browser to attach when subscribing. */
export function getPublicVapidKey(): string | null {
  return PUBLIC_KEY ?? null
}
