import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { PanelStudio } from './panel-studio'

export const dynamic = 'force-dynamic'

const PANEL_CATEGORIES = ['panels', 'hardwire_bp', 'wireless_bp']

export default async function PanelStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; equipmentId: string }>
  searchParams: Promise<{ review?: string; from?: string }>
}) {
  const { id, equipmentId } = await params
  const { review: reviewMemberId, from } = await searchParams
  const projectId = parseInt(id, 10)
  const eqId = parseInt(equipmentId, 10)
  if (isNaN(projectId) || isNaN(eqId)) notFound()

  const session = await getSession()
  if (!session) notFound()

  // Fetch equipment and verify it's a panel type
  const equipment = await prisma.equipment.findFirst({
    where: { id: eqId, projectId },
    select: {
      id: true,
      name: true,
      category: true,
      hardwareType: true,
      ipAddress: true,
      location: true,
      assignedToId: true,
    },
  })

  if (!equipment || !PANEL_CATEGORIES.includes(equipment.category)) notFound()

  // Get the assigned ProjectMember
  let member: {
    id: number
    userId: number
    firstName: string
    lastName: string
    position: string | null
    location: string | null
  } | null = null

  if (equipment.assignedToId) {
    const pm = await prisma.projectMember.findUnique({
      where: { id: equipment.assignedToId },
      select: {
        id: true,
        userId: true,
        position: true,
        location: true,
        user: { select: { firstName: true, lastName: true } },
      },
    })
    if (pm) {
      member = {
        id: pm.id,
        userId: pm.userId,
        firstName: pm.user.firstName,
        lastName: pm.user.lastName,
        position: pm.position,
        location: pm.location,
      }
    }
  }

  // Fetch PanelKey records for the member (if assigned)
  const panelKeysRaw = member
    ? await prisma.panelKey.findMany({
        where: { projectMemberId: member.id },
        select: {
          id: true,
          keyIndex: true,
          page: true,
          expansion: true,
          triggerMode: true,
          talkMode: true,
          pickListItemId: true,
          pickListItem: {
            select: { name: true, type: true },
          },
        },
        orderBy: [{ expansion: 'asc' }, { page: 'asc' }, { keyIndex: 'asc' }],
      })
    : []

  const panelKeys = panelKeysRaw.map((k) => ({
    id: k.id,
    keyIndex: k.keyIndex,
    page: k.page,
    expansion: k.expansion,
    label: k.pickListItem?.name ?? '',
    triggerMode: k.triggerMode,
    talkMode: k.talkMode,
    pickListItemId: k.pickListItemId,
    pickListItemName: k.pickListItem?.name ?? null,
    pickListItemType: k.pickListItem?.type ?? null,
  }))

  // Fetch all ProjectMembers for PTP entries, plus their equipment
  // categories so we can filter out members who can't reasonably receive
  // a PTP (see excludedPtpNames below).
  const ptpMembersRaw = await prisma.projectMember.findMany({
    where: { projectId },
    select: {
      id: true,
      position: true,
      user: { select: { firstName: true, lastName: true } },
      equipment: { select: { category: true } },
    },
    orderBy: { id: 'asc' },
  })

  // Auto-sync PTP PickListItems from project members
  // Each member gets a PTP pick list entry so it has a real PickListItem ID
  const existingPtp = await prisma.pickListItem.findMany({
    where: { projectId, type: 'PTP' },
    select: { id: true, name: true },
  })
  const existingPtpNames = new Set(existingPtp.map((p) => p.name))

  for (const m of ptpMembersRaw) {
    const ptpName = `${m.user.firstName} ${m.user.lastName}`
    if (!existingPtpNames.has(ptpName)) {
      await prisma.pickListItem.create({
        data: { projectId, name: ptpName, type: 'PTP', code: m.position },
      })
    }
  }

  // Members whose equipment is NON-EMPTY but consists of only hardwire
  // beltpacks can't be PTP'd practically — PTP to a hardwire beltpack
  // takes more resources than the studio typically has. Exclude them from
  // the picker's PTP list. Members with any panel / wireless gear stay
  // (even if they also have HWBP — the call just targets their panel),
  // and members with no equipment yet stay too (they may get kitted soon).
  const excludedPtpNames = new Set<string>()
  for (const m of ptpMembersRaw) {
    if (m.equipment.length === 0) continue
    const onlyHwbp = m.equipment.every((e) => e.category === 'hardwire_bp')
    if (onlyHwbp) excludedPtpNames.add(`${m.user.firstName} ${m.user.lastName}`)
  }

  // Fetch PickListItem records for the project, filtering out PTP items
  // whose member was flagged above.
  const pickListItemsAll = await prisma.pickListItem.findMany({
    where: { projectId },
    select: { id: true, code: true, name: true, type: true },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })
  const pickListItems = pickListItemsAll.filter(
    (p) => p.type !== 'PTP' || !excludedPtpNames.has(p.name),
  )

  const ptpMembers = ptpMembersRaw.map((m) => ({
    id: m.id,
    name: `${m.user.firstName} ${m.user.lastName}`,
    position: m.position,
  }))

  // Get project info (including status, so archived projects lock keys)
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, status: true },
  })

  if (!project) notFound()

  const isProjectArchived = project.status === 'archived'

  // Get session user's membership for permissions
  const currentMembership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId },
    select: { id: true, role: true },
  })

  const currentUserRole = currentMembership?.role || 'user'
  const isAdmin = currentUserRole === 'admin'
  const isManager = currentUserRole === 'manager'
  const isCrew = currentUserRole === 'crew'
  const isUser = currentUserRole === 'user'

  // canEditKeys:
  //   admin   → always
  //   manager → any panel (request mode)
  //   crew    → own panel only (request mode)
  //   user    → own panel only (request mode) — same as crew, can submit
  //             change requests for the gear assigned to them
  const isOwnPanel = member !== null && (
    currentMembership?.id === member.id ||
    member.userId === session.user.id
  )
  // Archived projects become read-only panels for everyone. The role-based
  // rules only apply when the project is still active.
  const canEditKeys =
    !isProjectArchived &&
    (isAdmin ||
      isManager ||
      ((isCrew || isUser) && isOwnPanel))

  // canManageExpansions: admin only
  const canManageExpansions = isAdmin

  // showIpAddress: admin, manager, crew can see it; user cannot
  const showIpAddress = isAdmin || isManager || isCrew

  // isRequestMode: true for everyone non-admin (their changes go through
  // approval); false for admin who can apply changes directly.
  const isRequestMode = !isAdmin && (isCrew || isManager || isUser)

  const isAdminGlobal = session.memberships.some((m) => m.role === 'admin')
  const isUserOnly = session.memberships.every((m) => m.role === 'user')
  const userName = `${session.user.firstName} ${session.user.lastName}`

  // ─── Review mode: load pending change requests for the target member ───
  let pendingChangeRequests: Array<{
    id: number
    status: string
    submitterName: string
    submitterRole: string
    createdAt: string
    items: Array<{
      id: number
      panelKeyId: number
      fieldChanged: string
      previousValue: string | null
      previousValueName: string | null
      newValue: string | null
      newValueName: string | null
      keyIndex: number
      page: string
      expansion: number
    }>
  }> = []

  const reviewTargetMemberId = reviewMemberId ? parseInt(reviewMemberId, 10) : null

  if (reviewTargetMemberId && isAdmin) {
    const rawCRs = await prisma.changeRequest.findMany({
      where: {
        targetMemberId: reviewTargetMemberId,
        status: { in: ['submitted', 'mgr_endorsed'] },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        submittedBy: { select: { firstName: true, lastName: true } },
        submittedById: true,
        projectId: true,
        items: {
          select: {
            id: true,
            panelKeyId: true,
            fieldChanged: true,
            previousValue: true,
            newValue: true,
            panelKey: {
              select: { keyIndex: true, page: true, expansion: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Get submitter roles
    const submitterRoleEntries = rawCRs.length > 0
      ? await prisma.projectMember.findMany({
          where: {
            OR: rawCRs.map((cr) => ({ userId: cr.submittedById, projectId: cr.projectId })),
          },
          select: { userId: true, projectId: true, role: true },
        })
      : []
    const submitterRoleMap = new Map(
      submitterRoleEntries.map((m) => [`${m.userId}-${m.projectId}`, m.role])
    )

    // Resolve pick list item names
    const pickItemIds = new Set<number>()
    for (const cr of rawCRs) {
      for (const item of cr.items) {
        if (item.previousValue) pickItemIds.add(parseInt(item.previousValue))
        if (item.newValue) pickItemIds.add(parseInt(item.newValue))
      }
    }
    const pickItemsForReview = pickItemIds.size > 0
      ? await prisma.pickListItem.findMany({
          where: { id: { in: Array.from(pickItemIds) } },
          select: { id: true, name: true },
        })
      : []
    const pickNameMap = new Map(pickItemsForReview.map((p) => [p.id, p.name]))

    pendingChangeRequests = rawCRs.map((cr) => ({
      id: cr.id,
      status: cr.status,
      submitterName: `${cr.submittedBy.firstName} ${cr.submittedBy.lastName}`,
      submitterRole: submitterRoleMap.get(`${cr.submittedById}-${cr.projectId}`) ?? 'crew',
      createdAt: cr.createdAt.toISOString(),
      items: cr.items.map((item) => ({
        id: item.id,
        panelKeyId: item.panelKeyId,
        fieldChanged: item.fieldChanged,
        previousValue: item.previousValue,
        previousValueName: item.previousValue ? (pickNameMap.get(parseInt(item.previousValue)) ?? null) : null,
        newValue: item.newValue,
        newValueName: item.newValue ? (pickNameMap.get(parseInt(item.newValue)) ?? null) : null,
        keyIndex: item.panelKey.keyIndex,
        page: item.panelKey.page,
        expansion: item.panelKey.expansion,
      })),
    }))
  }

  // Recent resolutions of this member's change requests — used by the
  // crew-side UI to tell them which of their submitted keys got approved
  // vs denied so we can show the right toast + revert state on denial.
  // Window is short (60s) so old resolutions don't re-trigger after
  // navigating back to the page.
  type ResolutionItem = {
    keyIndex: number
    page: string
    expansion: number
    approved: boolean
  }
  let recentResolutions: { id: number; resolvedAt: string; items: ResolutionItem[] }[] = []
  if (member && isOwnPanel) {
    const sixtySecondsAgo = new Date(Date.now() - 60_000)
    const recentCRs = await prisma.changeRequest.findMany({
      where: {
        targetMemberId: member.id,
        status: { in: ['applied', 'rejected'] },
        resolvedAt: { gte: sixtySecondsAgo },
      },
      include: {
        items: {
          include: {
            panelKey: {
              select: { keyIndex: true, page: true, expansion: true, pickListItemId: true },
            },
          },
        },
      },
      orderBy: { resolvedAt: 'asc' },
    })
    recentResolutions = recentCRs.map((cr) => ({
      id: cr.id,
      resolvedAt: cr.resolvedAt!.toISOString(),
      items: cr.items.map((i) => {
        // Heuristic: an item was approved if the current PanelKey value
        // matches what the item was trying to set. Denied items left the
        // PanelKey untouched (still at its previous value).
        const targetPickId = i.newValue ? parseInt(i.newValue) : null
        const currentPickId = i.panelKey.pickListItemId
        return {
          keyIndex: i.panelKey.keyIndex,
          page: i.panelKey.page,
          expansion: i.panelKey.expansion,
          approved: currentPickId === targetPickId,
        }
      }),
    }))
  }

  // Browse mode — when admin/manager arrives via My Equipment, fetch the
  // sibling data so we can render the project + user dropdowns, prev/next,
  // and a row of all the current member's gear at the top of the page.
  let browseProjects: Array<{ id: number; name: string }> | undefined
  let browseMembers:
    | Array<{
        id: number // entry id = equipmentId; one entry per panel-category device
        memberId: number
        firstName: string
        lastName: string
        position: string | null
        displayName: string
        equipmentId: number | null
        equipmentName: string | null // human ID like "PNL 1" — shown in dropdown
      }>
    | undefined
  let siblingGear:
    | Array<{
        id: number
        name: string
        category: string
        hardwareType: string | null
      }>
    | undefined

  const isBrowseEntry = from === 'my-equipment'
  const isManagerOrAdminGlobal = session.memberships.some(
    (m) => m.role === 'admin' || m.role === 'manager',
  )
  if (isBrowseEntry && isManagerOrAdminGlobal) {
    // Projects this user can browse — admin or manager on at least one.
    const myMemberships = await prisma.projectMember.findMany({
      where: { userId: session.user.id, project: { status: 'active' } },
      select: { role: true, project: { select: { id: true, name: true } } },
    })
    const browseProjectsMap = new Map<number, { id: number; name: string }>()
    for (const m of myMemberships) {
      if (m.role === 'admin' || m.role === 'manager') {
        if (!browseProjectsMap.has(m.project.id)) {
          browseProjectsMap.set(m.project.id, { id: m.project.id, name: m.project.name })
        }
      }
    }
    browseProjects = Array.from(browseProjectsMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )

    // One entry per panel-category device on THIS project — multi-device
    // members appear once per device. Sorted by equipment name (natural
    // numeric collation) so the dropdown reads "PNL 1, PNL 2, …, WLBP 1, …"
    const projMembers = await prisma.projectMember.findMany({
      where: { projectId, equipment: { some: {} } },
      select: {
        id: true,
        position: true,
        user: { select: { firstName: true, lastName: true } },
        equipment: {
          select: { id: true, category: true, name: true },
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
        },
      },
    })
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    browseMembers = projMembers
      .flatMap((m) =>
        m.equipment
          .filter((e) => PANEL_CATEGORIES.includes(e.category))
          .map((e) => ({
            // entry id = equipmentId so each device row is unique.
            id: e.id,
            memberId: m.id,
            firstName: m.user.firstName,
            lastName: m.user.lastName,
            position: m.position,
            displayName: `${m.user.firstName} ${m.user.lastName}`.trim(),
            equipmentId: e.id,
            equipmentName: e.name,
          })),
      )
      .sort((a, b) => collator.compare(a.equipmentName ?? '', b.equipmentName ?? ''))

    // Sibling gear — every equipment item assigned to the panel's
    // current member, scoped to THIS project. Drives the cards row.
    if (member) {
      siblingGear = await prisma.equipment.findMany({
        where: { projectId, assignedToId: member.id },
        select: { id: true, name: true, category: true, hardwareType: true },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      })
    }
  }

  return (
    <PanelStudio
      userName={userName}
      isAdminGlobal={isAdminGlobal}
      isUserOnly={isUserOnly}
      equipment={{
        id: equipment.id,
        name: equipment.name,
        category: equipment.category,
        hardwareType: equipment.hardwareType,
        ipAddress: equipment.ipAddress,
        location: equipment.location,
      }}
      member={member}
      project={{ id: project.id, name: project.name }}
      panelKeys={panelKeys}
      pickListItems={pickListItems}
      ptpMembers={ptpMembers}
      currentUserRole={currentUserRole}
      canEditKeys={canEditKeys}
      canManageExpansions={canManageExpansions}
      showIpAddress={showIpAddress}
      isRequestMode={isRequestMode}
      currentUserId={session.user.id}
      currentMemberId={currentMembership?.id ?? null}
      pendingChangeRequests={pendingChangeRequests}
      recentResolutions={recentResolutions}
      browseProjects={browseProjects}
      browseMembers={browseMembers}
      siblingGear={siblingGear}
    />
  )
}
