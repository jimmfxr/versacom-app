import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/racks/[rackId]/slots/[slotId] — update an existing RackSlot.
 * DELETE /api/racks/[rackId]/slots/[slotId] — remove a slot from the rack.
 *
 * Both endpoints share the same auth + ownership checks (admin or
 * manager on the rack's project; slot must belong to the URL's
 * rack). PATCH validates the same fields as the create endpoint and
 * re-runs the collision check (excluding the slot being edited).
 *
 * Body for PATCH (all optional — only changed fields need to be
 * sent):
 *   - ruPosition: number
 *   - ruSize: number
 *   - side: 'front' | 'rear'
 *   - deviceType: string
 *   - label: string
 *   - equipmentId: number | null
 *
 * Returns the updated slot (PATCH) or `{ ok: true }` (DELETE).
 */

async function loadAndAuthorize(rackId: string, slotId: string, userId: number) {
  const rackTemplateId = parseInt(rackId, 10)
  const slotIdInt = parseInt(slotId, 10)
  if (Number.isNaN(rackTemplateId) || Number.isNaN(slotIdInt)) {
    return { error: 'Invalid id', status: 400 as const }
  }
  const slot = await prisma.rackSlot.findUnique({
    where: { id: slotIdInt },
    select: {
      id: true,
      rackTemplateId: true,
      ruPosition: true,
      ruSize: true,
      side: true,
      deviceType: true,
      label: true,
      equipmentId: true,
      rackTemplate: { select: { id: true, totalRU: true, projectId: true } },
    },
  })
  if (!slot || slot.rackTemplateId !== rackTemplateId) {
    return { error: 'Slot not found', status: 404 as const }
  }
  if (!slot.rackTemplate.projectId) {
    return { error: 'Rack has no project — cannot edit', status: 400 as const }
  }
  const membership = await prisma.projectMember.findFirst({
    where: { userId, projectId: slot.rackTemplate.projectId },
    select: { role: true },
  })
  if (!membership || (membership.role !== 'admin' && membership.role !== 'manager')) {
    return { error: 'Forbidden', status: 403 as const }
  }
  return { slot }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ rackId: string; slotId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rackId, slotId } = await params
  const auth = await loadAndAuthorize(rackId, slotId, session.user.id)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { slot } = auth

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  // Build the patch object — only keys that were actually sent. We
  // then merge with the slot's current values for the collision check.
  const data: {
    ruPosition?: number
    ruSize?: number
    side?: string
    deviceType?: string
    label?: string
    equipmentId?: number | null
  } = {}

  if ('ruPosition' in b) {
    if (typeof b.ruPosition !== 'number' || !Number.isFinite(b.ruPosition) || b.ruPosition < 1) {
      return NextResponse.json({ error: 'ruPosition must be a positive integer' }, { status: 400 })
    }
    data.ruPosition = b.ruPosition
  }
  if ('ruSize' in b) {
    if (typeof b.ruSize !== 'number' || !Number.isFinite(b.ruSize) || b.ruSize < 1) {
      return NextResponse.json({ error: 'ruSize must be a positive integer' }, { status: 400 })
    }
    data.ruSize = b.ruSize
  }
  if ('side' in b) {
    if (b.side !== 'front' && b.side !== 'rear') {
      return NextResponse.json({ error: 'side must be front or rear' }, { status: 400 })
    }
    data.side = b.side
  }
  if ('deviceType' in b) {
    if (typeof b.deviceType !== 'string' || !b.deviceType.trim()) {
      return NextResponse.json({ error: 'deviceType required' }, { status: 400 })
    }
    data.deviceType = b.deviceType.trim()
  }
  if ('label' in b) {
    if (typeof b.label !== 'string') {
      return NextResponse.json({ error: 'label must be a string' }, { status: 400 })
    }
    data.label = b.label.trim() || (data.deviceType ?? slot.deviceType)
  }
  if ('equipmentId' in b) {
    if (b.equipmentId === null) data.equipmentId = null
    else if (typeof b.equipmentId === 'number' && Number.isFinite(b.equipmentId)) data.equipmentId = b.equipmentId
    else return NextResponse.json({ error: 'equipmentId must be a number or null' }, { status: 400 })
  }

  // Effective values after the patch.
  const nextRuPos = data.ruPosition ?? slot.ruPosition
  const nextRuSize = data.ruSize ?? slot.ruSize
  const nextSide = data.side ?? slot.side
  if (nextRuPos + nextRuSize - 1 > slot.rackTemplate.totalRU) {
    return NextResponse.json({ error: 'Slot exceeds rack height' }, { status: 400 })
  }

  // Collision check on the (possibly new) side, excluding this slot.
  const existing = await prisma.rackSlot.findMany({
    where: {
      rackTemplateId: slot.rackTemplateId,
      side: nextSide,
      id: { not: slot.id },
    },
    select: { ruPosition: true, ruSize: true },
  })
  const occupied = new Set<number>()
  for (const s of existing) {
    for (let i = 0; i < s.ruSize; i++) occupied.add(s.ruPosition + i)
  }
  for (let i = 0; i < nextRuSize; i++) {
    if (occupied.has(nextRuPos + i)) {
      return NextResponse.json({ error: 'RU range overlaps an existing slot' }, { status: 409 })
    }
  }

  const updated = await prisma.rackSlot.update({
    where: { id: slot.id },
    data,
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
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ rackId: string; slotId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rackId, slotId } = await params
  const auth = await loadAndAuthorize(rackId, slotId, session.user.id)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  await prisma.rackSlot.delete({ where: { id: auth.slot.id } })
  return NextResponse.json({ ok: true })
}
