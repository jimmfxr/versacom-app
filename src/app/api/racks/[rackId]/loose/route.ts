import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * POST /api/racks/[rackId]/loose — add a RackLooseItem to a rack.
 *
 * Loose items are devices that don't occupy a fixed RU position —
 * velcro'd to the inside of a chassis, in a drawer, zip-tied to the
 * side. They show up in the rack studio's tray above the chassis,
 * NOT in the RU column.
 *
 * Auth: admin or manager on the rack's project.
 *
 * Body:
 *   - deviceType: string (required) — display name, e.g. "Antaira"
 *   - label: string (optional) — overrides deviceType for display
 *   - equipmentId: number | null (optional) — link to a real
 *     Equipment row, future-proofing for the equipment-link feature
 *
 * Returns the created loose item.
 */

async function loadAndAuthorize(rackId: string, userId: number) {
  const rackTemplateId = parseInt(rackId, 10)
  if (Number.isNaN(rackTemplateId)) {
    return { error: 'Invalid id', status: 400 as const }
  }
  const rack = await prisma.rackTemplate.findUnique({
    where: { id: rackTemplateId },
    select: { id: true, projectId: true },
  })
  if (!rack) return { error: 'Rack not found', status: 404 as const }
  if (!rack.projectId) {
    return { error: 'Rack has no project — cannot edit', status: 400 as const }
  }
  const membership = await prisma.projectMember.findFirst({
    where: { userId, projectId: rack.projectId },
    select: { role: true },
  })
  if (!membership || (membership.role !== 'admin' && membership.role !== 'manager')) {
    return { error: 'Forbidden', status: 403 as const }
  }
  return { rack }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ rackId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rackId } = await params
  const auth = await loadAndAuthorize(rackId, session.user.id)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  const deviceType = typeof b.deviceType === 'string' ? b.deviceType.trim() : ''
  if (!deviceType) return NextResponse.json({ error: 'deviceType required' }, { status: 400 })

  const label = typeof b.label === 'string' && b.label.trim().length > 0
    ? b.label.trim()
    : null
  let equipmentId: number | null = null
  if ('equipmentId' in b) {
    if (b.equipmentId === null) equipmentId = null
    else if (typeof b.equipmentId === 'number' && Number.isFinite(b.equipmentId)) {
      equipmentId = b.equipmentId
    } else {
      return NextResponse.json({ error: 'equipmentId must be a number or null' }, { status: 400 })
    }
  }

  const loose = await prisma.rackLooseItem.create({
    data: {
      rackTemplateId: auth.rack.id,
      deviceType,
      label,
      equipmentId,
    },
    select: { id: true, deviceType: true, label: true, equipmentId: true },
  })
  return NextResponse.json(loose)
}
