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

  // Project name for the print header — the operator wanted the
  // printed sheet to identify which show this rack belongs to so a
  // crew handling racks for multiple projects can sort the pages.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  })
  if (!project) notFound()

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
          deviceType: true,
          // Pull the linked Equipment's location so switch (and any
          // other equipment-backed) slots can render 'NAME · location'
          // in the preview, matching how the editable library tile
          // shows the same information.
          equipment: {
            select: { location: true, category: true, hardwareType: true, ipAddress: true },
          },
        },
        orderBy: [{ side: 'asc' }, { ruPosition: 'asc' }],
      },
    },
  })
  if (!rack) notFound()

  return (
    <div className="min-h-screen w-full bg-[#202020] flex flex-col py-5 print:bg-white print:text-black print:py-2 print:min-h-0">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-1 flex-col print:px-4">
        <RackPreviewView
          projectId={projectId}
          rackTemplateId={rackTemplateId}
          projectName={project.name}
          rack={{ name: rack.name, location: rack.location, totalRU: rack.totalRU }}
          slots={rack.slots.map((s) => ({
            id: s.id,
            ruPosition: s.ruPosition,
            ruSize: s.ruSize,
            side: s.side,
            label: s.label,
            // Flatten the linked-equipment fields onto the slot so
            // the client doesn't need to know about the Equipment
            // relation shape. null when the slot isn't equipment-
            // backed (preset / custom device).
            linkedLocation: s.equipment?.location ?? null,
            linkedHardwareType: s.equipment?.hardwareType ?? null,
            linkedIpAddress: s.equipment?.ipAddress ?? null,
            // category drives layout in the preview — frames render IP
            // on its own row under the FRM id + model (per operator
            // PD-036); everything else keeps the single-row layout.
            linkedCategory: s.equipment?.category ?? null,
          }))}
        />
      </div>
    </div>
  )
}
