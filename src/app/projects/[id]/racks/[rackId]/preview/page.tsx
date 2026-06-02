import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { RackPreviewView } from './preview-view'

export const dynamic = 'force-dynamic'

/**
 * Chrome-free single-rack preview. Reached via the eye icon on an
 * expanded rack row in the Comms Racks tab. AppShell hides the
 * navbar + bottom-nav on this route (matched against
 * /projects/<id>/racks/<rackId>/preview) so the page is JUST the
 * rack — same treatment kiosk / public-zone pages get.
 *
 * Membership-gated like the rest of the project pages. Server-
 * fetches BOTH sides of slots so the client-side Front/Rear
 * toggle can switch instantly without another round trip.
 */
export default async function RackPreviewPage({
  params,
}: {
  params: Promise<{ id: string; rackId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id, rackId } = await params
  const projectId = parseInt(id, 10)
  const rackTemplateId = parseInt(rackId, 10)
  if (Number.isNaN(projectId) || Number.isNaN(rackTemplateId)) notFound()

  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId },
    select: { role: true },
  })
  if (!membership) notFound()

  const rack = await prisma.rackTemplate.findFirst({
    where: { id: rackTemplateId, projectId },
    select: {
      id: true,
      name: true,
      location: true,
      totalRU: true,
      slots: {
        select: {
          id: true,
          ruPosition: true,
          ruSize: true,
          side: true,
          label: true,
        },
        orderBy: [{ side: 'asc' }, { ruPosition: 'asc' }],
      },
    },
  })
  if (!rack) notFound()

  return (
    <div className="min-h-screen w-full bg-[#202020] flex flex-col py-5">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-1 flex-col">
        <RackPreviewView
          projectId={projectId}
          rackTemplateId={rackTemplateId}
          rack={{ name: rack.name, location: rack.location, totalRU: rack.totalRU }}
          slots={rack.slots}
        />
      </div>
    </div>
  )
}
