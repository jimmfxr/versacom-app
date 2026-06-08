import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { getSwitchModel } from '@/lib/switch-models'
import { SwitchStudio } from './switch-studio'

export const dynamic = 'force-dynamic'

/**
 * Switch Studio — per-switch chassis visualization with port-level
 * VLAN profile assignment. Lives at /projects/[id]/switch/[equipmentId]
 * and is reached by tapping the switch's ID text on the Comms
 * Equipment card.
 *
 * Server responsibilities:
 *   1. Auth-gate the page (any project member can VIEW; only admin +
 *      crew can EDIT, enforced both here and in the server action).
 *   2. Resolve the switch model (NETGEAR M4250 family) from the
 *      Equipment row's hardwareType. Equipment without a registered
 *      model (Antaira / TP Link / Pliant Hub / etc.) 404s — they're
 *      unmanaged and there's nothing to configure.
 *   3. Lazily seed SwitchPort rows on first open — read the model's
 *      defaultFor() table and insert one row per physical port with
 *      the operator's conventional default VLAN. Subsequent opens
 *      skip the seed and just read what's there.
 *   4. Fetch the global VlanProfile pool + the switch's port state
 *      and hand them to the client SwitchStudio.
 *
 * Mirrors Panel Studio / Rack Studio URL + role-gating patterns.
 */
export default async function SwitchStudioPage({
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

  // Membership gate — same as the rest of the project pages.
  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId },
    select: { role: true },
  })
  if (!membership) notFound()
  // User role is explicitly blocked from Switch Studio per the
  // operator decision. Belt-and-suspenders alongside the proxy gate.
  if (membership.role === 'user') notFound()
  const canEdit = membership.role === 'admin' || membership.role === 'crew'

  // Fetch the Equipment row + its switchPorts. category must be
  // 'switches' and hardwareType must match a registered NETGEAR
  // M4250 model — anything else has nothing to configure here.
  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentIdNum, projectId, category: 'switches' },
    select: {
      id: true,
      name: true,
      hardwareType: true,
      switchPorts: {
        select: {
          id: true,
          portIndex: true,
          portKind: true,
          profileId: true,
          isTrunk: true,
        },
        orderBy: { portIndex: 'asc' },
      },
    },
  })
  if (!equipment) notFound()
  const model = getSwitchModel(equipment.hardwareType)
  if (!model) notFound()

  // Lazy seed — on first open, the switchPorts array is empty. Read
  // the model's defaultFor() to determine each port's initial state,
  // resolve VLAN profile IDs by vlanId, and bulk-insert. Subsequent
  // visits skip this entirely.
  if (equipment.switchPorts.length === 0) {
    // One round-trip to grab every VLAN profile we might reference.
    const profiles = await prisma.vlanProfile.findMany({
      select: { id: true, vlanId: true },
    })
    const profileIdByVlanId = new Map<number, number>()
    for (const p of profiles) profileIdByVlanId.set(p.vlanId, p.id)

    const seeds: Array<{
      equipmentId: number
      portIndex: number
      portKind: string
      profileId: number | null
      isTrunk: boolean
    }> = []
    // RJ45 ports come first, then SFP — matches NETGEAR's physical
    // port-numbering convention.
    for (let i = 1; i <= model.rj45Count; i++) {
      const d = model.defaultFor(i, 'rj45')
      seeds.push({
        equipmentId: equipmentIdNum,
        portIndex: i,
        portKind: 'rj45',
        profileId: d.vlanId != null ? profileIdByVlanId.get(d.vlanId) ?? null : null,
        isTrunk: d.isTrunk,
      })
    }
    for (let j = 1; j <= model.sfpCount; j++) {
      const portIndex = model.rj45Count + j
      const d = model.defaultFor(portIndex, 'sfp')
      seeds.push({
        equipmentId: equipmentIdNum,
        portIndex,
        portKind: 'sfp',
        profileId: d.vlanId != null ? profileIdByVlanId.get(d.vlanId) ?? null : null,
        isTrunk: d.isTrunk,
      })
    }
    await prisma.switchPort.createMany({ data: seeds })
    // Re-fetch now that the seeds are in. Cheap — only the columns
    // the client needs.
    equipment.switchPorts = await prisma.switchPort.findMany({
      where: { equipmentId: equipmentIdNum },
      select: {
        id: true,
        portIndex: true,
        portKind: true,
        profileId: true,
        isTrunk: true,
      },
      orderBy: { portIndex: 'asc' },
    })
  }

  // Fetch the global VLAN profile pool for the picker. Sorted so the
  // popover groups read consistently with NETGEAR ProAV Engage.
  const profiles = await prisma.vlanProfile.findMany({
    select: {
      id: true,
      name: true,
      vlanId: true,
      color: true,
      profileType: true,
      description: true,
    },
    orderBy: { sortOrder: 'asc' },
  })

  // Project record + userProjects list — feed the ProjectSwitcher in
  // the studio header (same pattern as Rack Studio + Panel Studio).
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
      <SwitchStudio
        project={{ id: project.id, name: project.name }}
        userProjects={userProjects}
        equipment={{
          id: equipment.id,
          name: equipment.name,
          modelLabel: model.label,
          rj45Count: model.rj45Count,
          sfpCount: model.sfpCount,
        }}
        ports={equipment.switchPorts.map((p) => ({
          id: p.id,
          portIndex: p.portIndex,
          portKind: p.portKind as 'rj45' | 'sfp',
          profileId: p.profileId,
          isTrunk: p.isTrunk,
        }))}
        profiles={profiles}
        canEdit={canEdit}
      />
    </div>
  )
}
