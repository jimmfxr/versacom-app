import { NextResponse } from 'next/server'
import { getPublicVapidKey } from '@/lib/web-push'

export const dynamic = 'force-dynamic'
// web-push uses Node's crypto APIs; force Node runtime so this route
// doesn't try to run on Vercel Edge.
export const runtime = 'nodejs'

/**
 * Returns the public VAPID key the browser needs to call
 * `pushManager.subscribe({ applicationServerKey })`. Public so the
 * subscribe button can fetch it before prompting for permission.
 *
 * Returns 503 if VAPID is not configured — lets the client show a
 * graceful "notifications unavailable" state instead of throwing.
 */
export async function GET() {
  const key = getPublicVapidKey()
  if (!key) return NextResponse.json({ error: 'not-configured' }, { status: 503 })
  return NextResponse.json({ publicKey: key })
}
