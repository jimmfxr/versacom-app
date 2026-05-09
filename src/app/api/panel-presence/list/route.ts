import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// A row is considered active if its lastSeen is within this window.
// Tightened from 30s to 15s — most clean leaves are now handled by
// the explicit depart beacon in the client, so the stale window is
// only a backstop for browser crashes / lost network. 15s = 1.5
// heartbeats, enough headroom for one bad beat without flapping but
// fast enough that a closed tab disappears within ~15s.
const STALE_AFTER_MS = 15_000

/**
 * Returns the active (non-stale) PanelPresence rows for an
 * equipment. Excludes the current user — the client only wants to
 * see OTHERS in the room.
 *
 * Query: ?equipmentId=123
 * Response: { viewers: Array<{ userId, firstName, lastName, state, lastSeen }> }
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'not-authed' }, { status: 401 })

  const url = new URL(request.url)
  const equipmentId = Number(url.searchParams.get('equipmentId'))
  if (!Number.isFinite(equipmentId)) {
    return NextResponse.json({ error: 'invalid-equipmentId' }, { status: 400 })
  }

  const since = new Date(Date.now() - STALE_AFTER_MS)
  const rows = await prisma.panelPresence.findMany({
    where: {
      equipmentId,
      lastSeen: { gte: since },
      // Exclude self — client doesn't want to see itself in the strip.
      userId: { not: session.user.id },
    },
    select: {
      userId: true,
      state: true,
      lastSeen: true,
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { lastSeen: 'desc' },
  })

  type Row = (typeof rows)[number]
  return NextResponse.json({
    viewers: rows.map((r: Row) => ({
      userId: r.userId,
      firstName: r.user.firstName,
      lastName: r.user.lastName,
      state: r.state,
      lastSeen: r.lastSeen.toISOString(),
    })),
  })
}
