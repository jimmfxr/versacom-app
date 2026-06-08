import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { getFrameModel } from '@/lib/frame-models'
import { FrameStudio } from './frame-studio'

export const dynamic = 'force-dynamic'

/**
 * Frame Studio — per-frame chassis visualization with bay-level card-
 * type assignment for Riedel Artist frames (Artist 32 / MRF 64 / MFR
 * 128 / Artist 1024). Lives at /projects/[id]/frame/[equipmentId] and
 * is reached by tapping the frame's ID text (FRM N) on the Comms
 * Equipment card.
 *
 * Server responsibilities (mirror Switch Studio's page.tsx so the two
 * surfaces stay in lock-step):
 *   1. Auth-gate (any project member can VIEW; admin + crew can EDIT,
 *      enforced both here and in the server action).
 *   2. Resolve the frame model from the Equipment row's hardwareType.
 *      Equipment with no registered FrameModel (older / unmodelled
 *      frames) 404s — nothing to configure.
 *   3. Lazy-seed FrameSlot rows on first open — read the model's
 *      `bays[].defaultCard` and insert one row per bay. Subsequent
 *      opens skip the seed and just read what's there.
 *   4. Fetch project + userProjects list so the ProjectSwitcher in
 *      the studio header renders.
 */
export default async function FrameStudioPage({
  params,
}: {
  params: Promise<{ id: string; equipmentId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id, equipmentId } = await params
  const projectId = parseInt(id, 10)
  const equipmentIdNum = parseInt(equipmentId, 10)
  if (Number.isNaN(projectId) || Number.isNaN(equipmentIdNum)) notFound()

  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId },
    select: { role: true },
  })
  if (!membership) notFound()
  // User role is hard-blocked on Frame Studio per the operator's
  // role gating decision — same as Switch Studio.
  if (membership.role === 'user') notFound()
  const canEdit = membership.role === 'admin' || membership.role === 'crew'

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentIdNum, projectId, category: 'frames' },
    select: {
      id: true,
      name: true,
      hardwareType: true,
      ipAddress: true,
      frameNodeId: true,
      frameSlots: {
        select: {
          id: true,
          bayKey: true,
          cardType: true,
          notes: true,
        },
        orderBy: { bayKey: 'asc' },
      },
    },
  })
  if (!equipment) notFound()
  const model = getFrameModel(equipment.hardwareType)
  if (!model) notFound()

  // Lazy seed — on first open, frameSlots is empty. Iterate the
  // model's bays and insert one row per bay with the model's
  // `defaultCard`. Subsequent visits skip this entirely.
  if (equipment.frameSlots.length === 0) {
    const seeds = model.bays.map((bay) => ({
      equipmentId: equipmentIdNum,
      bayKey: bay.key,
      cardType: bay.defaultCard,
    }))
    await prisma.frameSlot.createMany({ data: seeds })
    equipment.frameSlots = await prisma.frameSlot.findMany({
      where: { equipmentId: equipmentIdNum },
      select: {
        id: true,
        bayKey: true,
        cardType: true,
        notes: true,
      },
      orderBy: { bayKey: 'asc' },
    })
  }

  // Project record + userProjects list — feed the ProjectSwitcher in
  // the studio header (same pattern as Switch Studio / Rack Studio /
  // Panel Studio).
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  })
  if (!project) notFound()
  const userProjectMemberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id },
    select: { project: { select: { id: true, name: true } } },
  })
  const userProjectsMap = new Map<number, { id: number; name: string }>()
  for (const m of userProjectMemberships) {
    if (!userProjectsMap.has(m.project.id)) {
      userProjectsMap.set(m.project.id, { id: m.project.id, name: m.project.name })
    }
  }
  const userProjects = Array.from(userProjectsMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-1 flex-col py-5">
      <FrameStudio
        project={{ id: project.id, name: project.name }}
        userProjects={userProjects}
        equipment={{
          id: equipment.id,
          name: equipment.name,
          modelLabel: model.label,
          modelKey: equipment.hardwareType ?? '',
          ipAddress: equipment.ipAddress,
          frameNodeId: equipment.frameNodeId,
          bayCount: model.bays.length,
        }}
        slots={equipment.frameSlots.map((s) => ({
          id: s.id,
          bayKey: s.bayKey,
          cardType: s.cardType,
          notes: s.notes,
        }))}
        canEdit={canEdit}
      />
    </div>
  )
}
