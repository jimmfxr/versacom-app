import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Upserts a PanelPresence row for the current user + equipment.
 * Called by the client every ~10 seconds while a Panel Studio page
 * is open. Updates `lastSeen` so the row stays "fresh" for the read
 * endpoint.
 *
 * Body: { equipmentId: number, state: 'viewing' | 'editing' }
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'not-authed' }, { status: 401 })

  type Body = { equipmentId?: number; state?: string }
  const body = (await request.json().catch(() => ({}))) as Body
  const equipmentId = Number(body.equipmentId)
  const state = body.state === 'editing' ? 'editing' : 'viewing'
  if (!Number.isFinite(equipmentId)) {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 })
  }

  // Quick membership check: only members of the equipment's project
  // (or global admins) should be visible in presence. Without this
  // gate any logged-in user could announce themselves as "viewing"
  // a panel on a project they don't belong to.
  const equipment = await prisma.equipment.findUnique({
    where: { id: equipmentId },
    select: { projectId: true },
  })
  if (!equipment) return NextResponse.json({ error: 'not-found' }, { status: 404 })

  const isAdminGlobal = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, role: 'admin' },
    select: { id: true },
  })
  if (!isAdminGlobal) {
    const member = await prisma.projectMember.findFirst({
      where: { userId: session.user.id, projectId: equipment.projectId },
      select: { id: true },
    })
    if (!member) {
      return NextResponse.json({ error: 'not-authorized' }, { status: 403 })
    }
  }

  await prisma.panelPresence.upsert({
    where: {
      userId_equipmentId: { userId: session.user.id, equipmentId },
    },
    update: { state, lastSeen: new Date() },
    create: { userId: session.user.id, equipmentId, state, lastSeen: new Date() },
  })

  return NextResponse.json({ ok: true })
}
