import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * POST /api/racks — create a new RackTemplate row.
 *
 * Auth: caller must be a Project admin or manager on the target
 * project (matches the per-tab Add gating in project-page.tsx).
 *
 * Body:
 *   - projectId: number (required) — the show to attach the rack to
 *   - name: string (required) — display name, e.g. "FOH Rack"
 *   - location: string | null (optional) — FOH / MON / STAGE / "Studio A"
 *   - totalRU: number (required) — total RU height of the chassis
 *   - dept: 'comms' | 'radios' (required) — which tab the rack
 *     appears under
 *
 * Returns the newly created rack row (with slotCount = 0).
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body !== 'object' || body === null) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const b = body as Record<string, unknown>
  const projectId = typeof b.projectId === 'number' ? b.projectId : NaN
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const location = typeof b.location === 'string' && b.location.trim().length > 0
    ? b.location.trim()
    : null
  const totalRU = typeof b.totalRU === 'number' ? b.totalRU : NaN
  const deptRaw = typeof b.dept === 'string' ? b.dept : ''
  const dept = deptRaw === 'comms' || deptRaw === 'radios' ? deptRaw : null

  if (!Number.isFinite(projectId)) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!Number.isFinite(totalRU) || totalRU < 1 || totalRU > 60) {
    return NextResponse.json({ error: 'totalRU must be 1–60' }, { status: 400 })
  }
  if (!dept) return NextResponse.json({ error: 'dept must be comms or radios' }, { status: 400 })

  // Permission: admin or manager on this project. Same gating as the
  // per-tab + (Add) button on project-page.tsx.
  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId },
    select: { role: true },
  })
  if (!membership || (membership.role !== 'admin' && membership.role !== 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rack = await prisma.rackTemplate.create({
    data: {
      name,
      location,
      totalRU,
      dept,
      type: 'custom',
      projectId,
    },
    select: { id: true, name: true, location: true, totalRU: true, dept: true },
  })

  return NextResponse.json({ ...rack, slotCount: 0 })
}
