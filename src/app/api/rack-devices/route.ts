import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * POST /api/rack-devices — create a project-scoped custom rack device.
 *
 * Custom devices show up in the rack studio's device library
 * alongside the hard-coded presets. They're scoped to a single
 * project + department (comms or radios) so a custom switch added on
 * Show A doesn't pollute the library on Show B. RackDevice can also
 * carry projectId=null for a future global library, but the create
 * endpoint requires a project — global library is admin-only and not
 * exposed via UI yet.
 *
 * Body:
 *   - projectId: number (required)
 *   - dept: 'comms' | 'radios' (required)
 *   - name: string (required) — display name in the library
 *   - ruSize: number (required) — 0 means loose, otherwise 1+
 *   - category: 'frames' | 'twoWire' | 'ptp' | 'switches' | 'audio' |
 *               'patchbay' | 'panels' | 'drawers' | 'power' | 'loose'
 *               (legacy 'devices' still accepted for backward
 *               compat — old custom devices may still POST it on
 *               re-save before the UI migrates them on read)
 *
 * Auth: admin or manager on the project (same gating as rack
 * creation).
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  const projectId = typeof b.projectId === 'number' ? b.projectId : NaN
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const ruSize = typeof b.ruSize === 'number' ? b.ruSize : NaN
  const deptRaw = typeof b.dept === 'string' ? b.dept : ''
  const dept = deptRaw === 'comms' || deptRaw === 'radios' ? deptRaw : null
  const catRaw = typeof b.category === 'string' ? b.category : ''
  // Accepts current categories + legacy 'devices' (pre-restructure
  // rows may still re-POST it; read path migrates to 'frames').
  const validCats = new Set(['frames', 'twoWire', 'ptp', 'switches', 'audio', 'patchbay', 'panels', 'drawers', 'power', 'loose', 'devices'])
  const category = validCats.has(catRaw) ? catRaw : null

  if (!Number.isFinite(projectId)) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!Number.isFinite(ruSize) || ruSize < 0 || ruSize > 60) {
    return NextResponse.json({ error: 'ruSize must be 0 (loose) or 1–60' }, { status: 400 })
  }
  if (!dept) return NextResponse.json({ error: 'dept must be comms or radios' }, { status: 400 })
  if (!category) return NextResponse.json({ error: 'category is invalid' }, { status: 400 })

  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId },
    select: { role: true },
  })
  if (!membership || (membership.role !== 'admin' && membership.role !== 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const device = await prisma.rackDevice.create({
    data: { name, ruSize, category, dept, projectId },
    select: { id: true, name: true, ruSize: true, category: true, dept: true, projectId: true },
  })
  return NextResponse.json(device)
}
