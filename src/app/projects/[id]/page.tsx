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

  const [project, equipment, memberRows, pickListItems, panelKeyUsage, expansionRows, allUsers, distinctPositions, headsetInventory, plots] = await Promise.all([
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
  ])

  // Project deleted (or stale lastProject cookie pointing nowhere). Bounce
  // back to /projects so the user can pick a valid one — clicking a real
  // project will overwrite the cookie and the Projects nav button stops
  // 404-ing.
  if (!project) redirect('/projects')

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

  const session = await getSession()
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
    />
  )
}
