import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/racks/[rackId] — update a rack's metadata (rename,
 * relocate, resize, change description).
 * DELETE /api/racks/[rackId] — remove the rack. Slots + loose items
 * cascade via the schema's ON DELETE CASCADE FK (set in the
 * 20260531000000_racks_dept_and_links migration).
 *
 * Both endpoints share auth: caller must be admin or manager on the
 * rack's project (same gating as the per-tab + and the slot edit
 * endpoints).
 *
 * PATCH body — all optional, only changed keys need to be sent:
 *   - name: string (1+ chars after trim)
 *   - location: string | null
 *   - description: string | null
 *   - totalRU: number (1–60). NOTE: shrinking below the highest
 *     occupied RU rejects with 409 so we don't orphan slots; the
 *     client must delete those slots first.
 *
 * Returns the updated rack (PATCH) or `{ ok: true }` (DELETE).
 */

async function loadAndAuthorize(rackId: string, userId: number) {
  const rackTemplateId = parseInt(rackId, 10)
  if (Number.isNaN(rackTemplateId)) {
    return { error: 'Invalid id', status: 400 as const }
  }
  const rack = await prisma.rackTemplate.findUnique({
    where: { id: rackTemplateId },
    select: { id: true, projectId: true, totalRU: true },
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ rackId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rackId } = await params
  const auth = await loadAndAuthorize(rackId, session.user.id)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { rack } = auth

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  const data: {
    name?: string
    location?: string | null
    description?: string | null
    totalRU?: number
  } = {}

  if ('name' in b) {
    if (typeof b.name !== 'string' || !b.name.trim()) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
    }
    data.name = b.name.trim()
  }
  if ('location' in b) {
    if (b.location === null) data.location = null
    else if (typeof b.location === 'string') {
      const trimmed = b.location.trim()
      data.location = trimmed.length > 0 ? trimmed : null
    } else {
      return NextResponse.json({ error: 'location must be a string or null' }, { status: 400 })
    }
  }
  if ('description' in b) {
    if (b.description === null) data.description = null
    else if (typeof b.description === 'string') {
      const trimmed = b.description.trim()
      data.description = trimmed.length > 0 ? trimmed : null
    } else {
      return NextResponse.json({ error: 'description must be a string or null' }, { status: 400 })
    }
  }
  if ('totalRU' in b) {
    if (typeof b.totalRU !== 'number' || !Number.isFinite(b.totalRU) || b.totalRU < 1 || b.totalRU > 60) {
      return NextResponse.json({ error: 'totalRU must be 1–60' }, { status: 400 })
    }
    // If the user is shrinking the rack, make sure no slot extends
    // past the new last RU. Easier to refuse and let the operator
    // delete the offending slot than to delete it for them.
    if (b.totalRU < rack.totalRU) {
      const maxOccupied = await prisma.rackSlot.findFirst({
        where: { rackTemplateId: rack.id },
        select: { ruPosition: true, ruSize: true },
        orderBy: [{ ruPosition: 'desc' }],
      })
      const lastUsed = maxOccupied ? maxOccupied.ruPosition + maxOccupied.ruSize - 1 : 0
      if (lastUsed > b.totalRU) {
        return NextResponse.json({
          error: `Can't shrink — a slot still extends to RU ${lastUsed}. Delete it first.`,
        }, { status: 409 })
      }
    }
    data.totalRU = b.totalRU
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const updated = await prisma.rackTemplate.update({
    where: { id: rack.id },
    data,
    select: {
      id: true,
      name: true,
      description: true,
      location: true,
      totalRU: true,
      dept: true,
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ rackId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rackId } = await params
  const auth = await loadAndAuthorize(rackId, session.user.id)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  // Slots + loose items cascade via the schema FK. No manual cleanup.
  await prisma.rackTemplate.delete({ where: { id: auth.rack.id } })
  return NextResponse.json({ ok: true })
}
