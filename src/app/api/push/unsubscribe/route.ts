import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Deletes the current user's PushSubscription matching the supplied
 * endpoint. No-op if the row doesn't exist.
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'not-authed' }, { status: 401 })

  type Body = { endpoint?: string }
  const body = (await request.json().catch(() => ({}))) as Body
  const endpoint = body.endpoint
  if (!endpoint) return NextResponse.json({ error: 'invalid-body' }, { status: 400 })

  // Scope by userId too so a user can't drop another user's
  // subscription by guessing their endpoint.
  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: session.user.id },
  })
  return NextResponse.json({ ok: true })
}
