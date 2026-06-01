import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/racks/[rackId]/loose/[looseId] — remove a loose-gear
 * item from a rack. The × on a tray chip routes here.
 *
 * Auth: admin or manager on the rack's project. The loose item must
 * belong to the URL's rack (no cross-rack deletes via crafted URLs).
 *
 * PATCH lands later if/when we wire loose-item editing — for now the
 * UX is add + remove only, so PATCH would be premature.
 */

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ rackId: string; looseId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rackId, looseId } = await params
  const rackTemplateId = parseInt(rackId, 10)
  const looseIdInt = parseInt(looseId, 10)
  if (Number.isNaN(rackTemplateId) || Number.isNaN(looseIdInt)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  const loose = await prisma.rackLooseItem.findUnique({
    where: { id: looseIdInt },
    select: {
      id: true,
      rackTemplateId: true,
      rackTemplate: { select: { id: true, projectId: true } },
    },
  })
  if (!loose || loose.rackTemplateId !== rackTemplateId) {
    return NextResponse.json({ error: 'Loose item not found' }, { status: 404 })
  }
  if (!loose.rackTemplate.projectId) {
    return NextResponse.json({ error: 'Rack has no project — cannot edit' }, { status: 400 })
  }
  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId: loose.rackTemplate.projectId },
    select: { role: true },
  })
  if (!membership || (membership.role !== 'admin' && membership.role !== 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  await prisma.rackLooseItem.delete({ where: { id: loose.id } })
  return NextResponse.json({ ok: true })
}
