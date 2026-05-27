import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * Returns the join PIN for a project, gated to people who can already
 * see the project (membership row, or global admin via admin-on-any).
 *
 * Used by the global navbar's "Show join QR" button — the modal opens
 * on the current project and fetches the PIN on demand, so the PIN
 * never has to be threaded through the layout / cookie pipeline.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id } = await params
  const projectId = Number.parseInt(id, 10)
  if (!Number.isFinite(projectId)) {
    return NextResponse.json({ error: 'bad-id' }, { status: 400 })
  }

  const [membership, globalAdmin, project] = await Promise.all([
    prisma.projectMember.findFirst({
      where: { projectId, userId: session.user.id },
      select: { id: true },
    }),
    prisma.projectMember.findFirst({
      where: { userId: session.user.id, role: 'admin' },
      select: { id: true },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, pin: true },
    }),
  ])

  if (!project) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 })
  }
  if (!membership && !globalAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  return NextResponse.json({ pin: project.pin, name: project.name })
}
