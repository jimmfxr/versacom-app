import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Stores a Web Push subscription for the current user. Idempotent on
 * `endpoint` — re-subscribing the same browser overwrites the keys.
 *
 * Body shape (matches `PushSubscription.toJSON()` from the browser):
 * {
 *   endpoint: string,
 *   keys: { p256dh: string, auth: string }
 * }
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'not-authed' }, { status: 401 })

  type Body = { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  const body = (await request.json().catch(() => ({}))) as Body
  const endpoint = body.endpoint
  const p256dh = body.keys?.p256dh
  const auth = body.keys?.auth

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 })
  }

  // Upsert on endpoint so a re-subscription updates rather than
  // duplicates. The user binding moves with the endpoint — if a
  // subscription was previously held by another user (e.g. on a
  // shared device), the new login takes over.
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: session.user.id, p256dh, auth },
    create: { userId: session.user.id, endpoint, p256dh, auth },
  })

  return NextResponse.json({ ok: true })
}
