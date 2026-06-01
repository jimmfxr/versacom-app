import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * POST /api/racks/[rackId]/slots — add a new RackSlot to a rack.
 *
 * Auth: caller must be admin or manager on the project that owns
 * the target rack. The check is enforced server-side so callers
 * can't forge a slot insert on a rack they don't have permission
 * to edit.
 *
 * Body:
 *   - ruPosition: number (required, 1..rack.totalRU)
 *   - ruSize: number (required, 1..rack.totalRU - ruPosition + 1)
 *   - side: 'front' | 'rear' (required)
 *   - deviceType: string (required) — the device's display label
 *     (matches a name in the preset library OR a custom-device row)
 *   - label: string (optional) — operator-overridable nickname,
 *     defaults to deviceType
 *   - equipmentId: number | null (optional) — link to a real
 *     Equipment row so deploy status flows through
 *
 * Returns the newly-created RackSlot row.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ rackId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rackId } = await params
  const rackTemplateId = parseInt(rackId, 10)
  if (Number.isNaN(rackTemplateId)) {
    return NextResponse.json({ error: 'Invalid rackId' }, { status: 400 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const ruPosition = typeof b.ruPosition === 'number' ? b.ruPosition : NaN
  const ruSize = typeof b.ruSize === 'number' ? b.ruSize : NaN
  const side = typeof b.side === 'string' && (b.side === 'front' || b.side === 'rear') ? b.side : null
  const deviceType = typeof b.deviceType === 'string' ? b.deviceType.trim() : ''
  const label = typeof b.label === 'string' && b.label.trim().length > 0 ? b.label.trim() : null
  const equipmentId = typeof b.equipmentId === 'number' ? b.equipmentId : null

  if (!Number.isFinite(ruPosition) || ruPosition < 1) {
    return NextResponse.json({ error: 'ruPosition must be a positive integer' }, { status: 400 })
  }
  if (!Number.isFinite(ruSize) || ruSize < 1) {
    return NextResponse.json({ error: 'ruSize must be a positive integer' }, { status: 400 })
  }
  if (!side) return NextResponse.json({ error: 'side must be front or rear' }, { status: 400 })
  if (!deviceType) return NextResponse.json({ error: 'deviceType required' }, { status: 400 })

  // Load the rack to check project membership + bounds.
  const rack = await prisma.rackTemplate.findUnique({
    where: { id: rackTemplateId },
    select: { id: true, projectId: true, totalRU: true },
  })
  if (!rack) return NextResponse.json({ error: 'Rack not found' }, { status: 404 })
  if (!rack.projectId) {
    return NextResponse.json({ error: 'Rack has no project — cannot edit' }, { status: 400 })
  }
  if (ruPosition + ruSize - 1 > rack.totalRU) {
    return NextResponse.json({ error: 'Slot exceeds rack height' }, { status: 400 })
  }

  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId: rack.projectId },
    select: { role: true },
  })
  if (!membership || (membership.role !== 'admin' && membership.role !== 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Collision check — must not overlap any existing slot on the same side.
  const existing = await prisma.rackSlot.findMany({
    where: { rackTemplateId, side },
    select: { ruPosition: true, ruSize: true },
  })
  const occupied = new Set<number>()
  for (const s of existing) {
    for (let i = 0; i < s.ruSize; i++) occupied.add(s.ruPosition + i)
  }
  for (let i = 0; i < ruSize; i++) {
    if (occupied.has(ruPosition + i)) {
      return NextResponse.json({ error: 'RU range overlaps an existing slot' }, { status: 409 })
    }
  }

  const slot = await prisma.rackSlot.create({
    data: {
      rackTemplateId,
      ruPosition,
      ruSize,
      side,
      deviceType,
      label: label ?? deviceType,
      equipmentId,
    },
    select: {
      id: true,
      ruPosition: true,
      ruSize: true,
      side: true,
      deviceType: true,
      label: true,
      color: true,
      equipmentId: true,
    },
  })
  return NextResponse.json(slot, { status: 201 })
}
