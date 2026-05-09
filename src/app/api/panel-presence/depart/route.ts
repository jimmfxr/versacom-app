import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Removes the current user's PanelPresence row for the given
 * equipment. Called immediately when the user closes the tab,
 * switches tab away, or navigates off the panel — so the strip
 * doesn't linger for 30s on the other viewer's screen.
 *
 * Also accepts navigator.sendBeacon, which sends as
 * application/json or text/plain. Body shape:
 *   { equipmentId: number }
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'not-authed' }, { status: 401 })

  type Body = { equipmentId?: number }
  // sendBeacon sends body as a Blob — we still get text via .text().
  let body: Body = {}
  try {
    const raw = await request.text()
    if (raw) body = JSON.parse(raw) as Body
  } catch {
    // ignore — empty / malformed body is fine, we noop
  }
  const equipmentId = Number(body.equipmentId)
  if (!Number.isFinite(equipmentId)) {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 })
  }

  await prisma.panelPresence.deleteMany({
    where: { userId: session.user.id, equipmentId },
  })

  return NextResponse.json({ ok: true })
}
