import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/rack-devices/[deviceId] — rename / re-size / re-categorize
 *   a custom device.
 * DELETE /api/rack-devices/[deviceId] — remove it from the library.
 *
 * Note: deleting a custom device does NOT clean up any RackSlot rows
 * that were created from it. Those slots stay put with whatever
 * deviceType string they were stamped with at the time, since the
 * slot's identity is its label/position, not its origin in the
 * library. If we wanted to track-and-update slots when their source
 * device changes, that'd be a separate feature.
 *
 * Auth: admin or manager on the device's project. Global devices
 * (projectId=null) reject — no UI for that yet.
 */

async function loadAndAuthorize(deviceId: string, userId: number) {
  const id = parseInt(deviceId, 10)
  if (Number.isNaN(id)) {
    return { error: 'Invalid id', status: 400 as const }
  }
  const device = await prisma.rackDevice.findUnique({
    where: { id },
    select: { id: true, projectId: true },
  })
  if (!device) return { error: 'Device not found', status: 404 as const }
  if (!device.projectId) {
    return { error: 'Global devices cannot be edited via this endpoint', status: 403 as const }
  }
  const membership = await prisma.projectMember.findFirst({
    where: { userId, projectId: device.projectId },
    select: { role: true },
  })
  if (!membership || (membership.role !== 'admin' && membership.role !== 'manager')) {
    return { error: 'Forbidden', status: 403 as const }
  }
  return { device }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { deviceId } = await params
  const auth = await loadAndAuthorize(deviceId, session.user.id)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  const data: { name?: string; ruSize?: number; category?: string } = {}
  if ('name' in b) {
    if (typeof b.name !== 'string' || !b.name.trim()) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
    }
    data.name = b.name.trim()
  }
  if ('ruSize' in b) {
    if (typeof b.ruSize !== 'number' || !Number.isFinite(b.ruSize) || b.ruSize < 0 || b.ruSize > 60) {
      return NextResponse.json({ error: 'ruSize must be 0 or 1–60' }, { status: 400 })
    }
    data.ruSize = b.ruSize
  }
  if ('category' in b) {
    // Current categories + legacy 'devices' for pre-restructure rows.
    const validCats = new Set(['frames', 'twoWire', 'ptp', 'switches', 'audio', 'patchbay', 'panels', 'drawers', 'power', 'loose', 'devices'])
    if (typeof b.category !== 'string' || !validCats.has(b.category)) {
      return NextResponse.json({ error: 'category is invalid' }, { status: 400 })
    }
    data.category = b.category
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const updated = await prisma.rackDevice.update({
    where: { id: auth.device.id },
    data,
    select: { id: true, name: true, ruSize: true, category: true, dept: true, projectId: true },
  })
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { deviceId } = await params
  const auth = await loadAndAuthorize(deviceId, session.user.id)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  await prisma.rackDevice.delete({ where: { id: auth.device.id } })
  return NextResponse.json({ ok: true })
}
