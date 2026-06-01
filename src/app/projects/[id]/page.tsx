import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { ProjectPage } from './project-page'

export const dynamic = 'force-dynamic'

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) notFound()

  const session = await getSession()
  const userId = session?.user.id ?? null

  const [project, equipment, memberRows, pickListItems, panelKeyUsage, expansionRows, allUsers, distinctPositions, distinctDepartments, headsetInventory, plots, userProjectMemberships, commsRackRows, commsCustomDevices] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        pin: true,
        status: true,
        createdAt: true,
        returnPhaseActive: true,
        // Misc-accessory "brought" counts — needed by the inventory editor
        // we render under the Equipment tab.
        goosenecksBrought: true,
        footswitchesBrought: true,
        speakersBrought: true,
        quarterXlrmBrought: true,
        db9XlrfBrought: true,
        rj45XlrmfBrought: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        members: {
          select: {
            id: true,
            role: true,
            position: true,
            department: true,
            location: true,
            // `pin` is selected only to compute `hasPin` below — never shipped
            // to the client. It's null until the user completes their first
            // login via the project PIN and sets a personal PIN.
            user: { select: { id: true, firstName: true, lastName: true, pin: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    }),
    prisma.equipment.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        category: true,
        hardwareType: true,
        position: true,
        location: true,
        headsetType: true,
        ipAddress: true,
        patch: true,
        deployStatus: true,
        assignedToId: true,
        gooseneck: true,
        footswitches: true,
        speakers: true,
        // Mult-specific columns. Null on non-mult rows.
        trunkEquipmentId: true,
        strandCount: true,
        lengthFeet: true,
        assignedTo: {
          select: {
            id: true,
            position: true,
            department: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
        // Strands belong to mults only — Prisma returns an empty
        // array for non-mult rows. Ordered by index so the UI can
        // render the list 1..N without re-sorting.
        strands: {
          select: {
            id: true,
            index: true,
            channelName: true,
            attachedEquipmentId: true,
          },
          orderBy: { index: 'asc' },
        },
        // Reverse: every mult strand pointing AT this Equipment row.
        // Lets switches + Pliant antennas display the mult patches
        // wired to them ("FBR A ch1, ETH B ch5") in their card body.
        // Empty for rows that nothing attaches to (panels with no
        // mult wiring yet, etc.).
        attachedStrands: {
          select: {
            id: true,
            index: true,
            channelName: true,
            mult: {
              select: { id: true, name: true, hardwareType: true },
            },
          },
          orderBy: [{ multEquipmentId: 'asc' }, { index: 'asc' }],
        },
      },
      orderBy: [{ category: 'asc' }, { id: 'asc' }],
    }),
    prisma.projectMember.findMany({
      where: { projectId },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.pickListItem.findMany({
      where: { projectId },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { id: 'asc' },
    }),
    // Pick list usage: which user has each pick list item assigned to a panel
    // key (across main + shift + any expansion). Used to render "X, Y, Z" in
    // cyan beneath each pick list card on the project's Pick List tab.
    prisma.panelKey.findMany({
      where: {
        pickListItemId: { not: null },
        projectMember: { projectId },
      },
      select: {
        pickListItemId: true,
        projectMember: {
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
    // Expansion modules per member: a row exists for every (member, expansion)
    // combo that has at least one key. Counted client-side to render "exp: N"
    // next to each member's equipment on the Team tab.
    prisma.panelKey.findMany({
      where: {
        projectMember: { projectId },
        expansion: { gt: 0 },
      },
      select: { projectMemberId: true, expansion: true },
      distinct: ['projectMemberId', 'expansion'],
    }),
    // Autocomplete sources for the Add Member form. Pulled across the whole
    // DB (not just this project) so common entries like "Lighting", "Audio",
    // and known crew members propagate consistently across shows.
    prisma.user.findMany({
      select: { firstName: true, lastName: true },
    }),
    prisma.projectMember.findMany({
      where: { position: { not: null } },
      select: { position: true },
      distinct: ['position'],
    }),
    // Distinct departments across every project (same rationale as the
    // positions list above) so "Audio", "RF", "Lighting" etc. autocomplete
    // when admins type one on a new show.
    prisma.projectMember.findMany({
      where: { department: { not: null } },
      select: { department: true },
      distinct: ['department'],
    }),
    // Per-project headset inventory counts — drives the new Inventory tab
    // inside the Add Equipment card.
    prisma.projectHeadsetInventory.findMany({
      where: { projectId },
      select: { headsetType: true, brought: true },
    }),
    // Stage plots — label + external URL (typically Google Drive).
    // Loaded once per project; mutations go through plot-actions.ts.
    prisma.plot.findMany({
      where: { projectId },
      select: { id: true, label: true, url: true },
      orderBy: { createdAt: 'asc' },
    }),
    // Every active project the current user belongs to — feeds the
    // ProjectSwitcher that now sits in the Comms-page header action
    // area so the user can flip between shows without leaving
    // /projects/<id>.
    userId == null
      ? Promise.resolve([])
      : prisma.projectMember.findMany({
          where: { userId, project: { status: 'active' } },
          select: { project: { select: { id: true, name: true } } },
        }),
    // Racks scoped to this project + dept='comms'. Used to render the
    // Racks tab body AND power the inline rack studio expansion —
    // clicking Edit on a rack row opens the full rack studio in place,
    // so we need slots + looseItems up front. Cheap for typical
    // projects (3-15 racks, a few hundred slots at the extreme).
    prisma.rackTemplate.findMany({
      where: { projectId, dept: 'comms' },
      select: {
        id: true,
        name: true,
        description: true,
        location: true,
        totalRU: true,
        dept: true,
        slots: {
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
          orderBy: [{ side: 'asc' }, { ruPosition: 'asc' }],
        },
        looseItems: {
          select: { id: true, deviceType: true, label: true, equipmentId: true },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: [{ name: 'asc' }],
    }),
    // Project-scoped custom rack devices (dept='comms'). These show
    // up in the rack studio's device library alongside the hard-coded
    // presets from src/lib/rack-presets.ts. Per-project so a custom
    // switch on Show A doesn't leak onto Show B.
    prisma.rackDevice.findMany({
      where: { projectId, dept: 'comms' },
      select: { id: true, name: true, ruSize: true, category: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
  ])

  // Project deleted (or stale lastProject cookie pointing nowhere). Bounce
  // back to /projects so the user can pick a valid one — clicking a real
  // project will overwrite the cookie and the Projects nav button stops
  // 404-ing.
  if (!project) redirect('/projects')

  // Active-project list for the Comms-page ProjectSwitcher. De-duped
  // (a user can have multiple memberships on the same project) and
  // sorted alphabetically so the dropdown reads cleanly.
  const userProjectsMap = new Map<number, { id: number; name: string }>()
  for (const m of userProjectMemberships) {
    if (!userProjectsMap.has(m.project.id)) {
      userProjectsMap.set(m.project.id, { id: m.project.id, name: m.project.name })
    }
  }
  const userProjects = Array.from(userProjectsMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )

  // Distinct lists for the Add Member autocomplete dropdowns.
  const firstNameSuggestions = Array.from(
    new Set(allUsers.map((u) => u.firstName.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))
  const lastNameSuggestions = Array.from(
    new Set(allUsers.map((u) => u.lastName.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))
  const positionSuggestions = Array.from(
    new Set(distinctPositions.map((m) => m.position?.trim() || '').filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))
  const departmentSuggestions = Array.from(
    new Set(distinctDepartments.map((m) => m.department?.trim() || '').filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))

  // Build equipment-per-member map
  const memberEquipmentMap: Record<number, string[]> = {}
  for (const e of equipment) {
    if (e.assignedToId) {
      if (!memberEquipmentMap[e.assignedToId]) memberEquipmentMap[e.assignedToId] = []
      memberEquipmentMap[e.assignedToId].push(e.name)
    }
  }

  // Build pick-list usage map: pickListItemId → sorted, deduped user names
  const pickListUsageMap = new Map<number, Set<string>>()
  for (const k of panelKeyUsage) {
    if (k.pickListItemId == null) continue
    const name = `${k.projectMember.user.firstName} ${k.projectMember.user.lastName}`
    if (!pickListUsageMap.has(k.pickListItemId)) pickListUsageMap.set(k.pickListItemId, new Set())
    pickListUsageMap.get(k.pickListItemId)!.add(name)
  }

  // Build expansion-count map: projectMemberId → number of expansion modules
  const expansionCountMap = new Map<number, number>()
  for (const e of expansionRows) {
    expansionCountMap.set(e.projectMemberId, (expansionCountMap.get(e.projectMemberId) ?? 0) + 1)
  }

  const userName = session ? `${session.user.firstName} ${session.user.lastName}` : undefined

  // Find the current user's role and member ID for this project
  const currentMembership = session
    ? project.members.find((m) => m.user.id === session.user.id)
    : null
  // Global admins (admin on any project) get 'admin' role on every project
  // they view — even if they have no explicit membership on this one.
  // This covers the orphan-project case where the admin's own membership
  // was wiped by an earlier incomplete delete, leaving them locked out of
  // the controls that would let them clean up.
  const isGlobalAdmin = session?.memberships.some((m) => m.role === 'admin') ?? false
  const currentUserRole = currentMembership?.role || (isGlobalAdmin ? 'admin' : 'user')
  const currentMemberId = currentMembership?.id || null

  const isAdmin = session?.memberships.some((m) => m.role === 'admin') ?? false
  const isUserOnly = session ? session.memberships.every((m) => m.role === 'user') : false

  // Non-admins can only view projects they belong to. If they hit a project
  // they were removed from (stale cookie or shared link), redirect to the
  // list rather than 404 — same self-healing rationale as the deleted case.
  if (!isAdmin && !currentMembership) redirect('/projects')

  return (
    <ProjectPage
      userName={userName}
      isAdmin={isAdmin}
      isUserOnly={isUserOnly}
      currentUserRole={currentUserRole}
      currentMemberId={currentMemberId}
      firstNameSuggestions={firstNameSuggestions}
      lastNameSuggestions={lastNameSuggestions}
      positionSuggestions={positionSuggestions}
      departmentSuggestions={departmentSuggestions}
      userProjects={userProjects}
      project={{
        id: project.id,
        name: project.name,
        pin: project.pin || '',
        status: project.status,
        createdAt: project.createdAt.toISOString(),
        returnPhaseActive: project.returnPhaseActive,
        createdBy: project.createdBy,
        members: project.members.map((m) => ({
          id: m.id,
          role: m.role,
          position: m.position,
          department: m.department,
          location: m.location,
          userId: m.user.id,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          equipmentNames: memberEquipmentMap[m.id] || [],
          expansionCount: expansionCountMap.get(m.id) ?? 0,
          hasPin: Boolean(m.user.pin),
        })),
      }}
      equipment={equipment.map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category,
        hardwareType: e.hardwareType,
        position: e.position,
        location: e.location,
        headsetType: e.headsetType,
        ipAddress: e.ipAddress,
        patch: e.patch,
        deployStatus: e.deployStatus,
        assignedToId: e.assignedToId,
        assignedToName: e.assignedTo
          ? `${e.assignedTo.user.firstName} ${e.assignedTo.user.lastName}`
          : null,
        assignedToPosition: e.assignedTo?.position ?? null,
        assignedToDepartment: e.assignedTo?.department ?? null,
        assignedMemberId: e.assignedTo?.id ?? null,
        gooseneck: e.gooseneck,
        footswitches: e.footswitches,
        speakers: e.speakers,
        trunkEquipmentId: e.trunkEquipmentId,
        strandCount: e.strandCount,
        lengthFeet: e.lengthFeet,
        strands: e.strands,
        attachedStrands: e.attachedStrands.map((s) => ({
          id: s.id,
          index: s.index,
          channelName: s.channelName,
          multId: s.mult.id,
          multName: s.mult.name,
          multHardwareType: s.mult.hardwareType,
        })),
      }))}
      assignableMembers={memberRows.map((m) => ({
        id: m.id,
        name: `${m.user.firstName} ${m.user.lastName}`,
      }))}
      pickListItems={pickListItems.map((p) => ({
        ...p,
        users: Array.from(pickListUsageMap.get(p.id) ?? []).sort((a, b) =>
          a.localeCompare(b),
        ),
      }))}
      headsetInventory={headsetInventory}
      miscInventory={{
        goosenecksBrought: project.goosenecksBrought,
        footswitchesBrought: project.footswitchesBrought,
        speakersBrought: project.speakersBrought,
        quarterXlrmBrought: project.quarterXlrmBrought,
        db9XlrfBrought: project.db9XlrfBrought,
        rj45XlrmfBrought: project.rj45XlrmfBrought,
      }}
      plots={plots}
      commsRacks={commsRackRows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        location: r.location,
        totalRU: r.totalRU,
        dept: r.dept,
        slotCount: r.slots.length,
        slots: r.slots,
        looseItems: r.looseItems,
      }))}
      commsCustomDevices={commsCustomDevices}
      rackEquipment={equipment
        // Rack-eligible categories. Panels sit on desks, not in
        // racks, so they're excluded. Add categories here when a
        // new kind of gear becomes rack-mountable.
        .filter((e) => ['switches', 'audio'].includes(e.category))
        .map((e) => ({
          id: e.id,
          name: e.name,
          category: e.category,
          hardwareType: e.hardwareType,
          location: e.location,
          ipAddress: e.ipAddress,
          deployStatus: e.deployStatus,
        }))}
      rackedEquipmentIds={
        // Already-claimed equipment ids, gathered from every comms
        // rack's slots. Picker dims these so the operator can't
        // accidentally double-rack a unit.
        Array.from(new Set(
          commsRackRows.flatMap((r) =>
            r.slots
              .map((s) => s.equipmentId)
              .filter((id): id is number => id != null),
          ),
        ))
      }
    />
  )
}
