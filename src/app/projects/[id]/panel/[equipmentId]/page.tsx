import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { notifyReviewStarted } from '@/lib/notifications'
import { PanelStudio } from './panel-studio'
import { RadioStudio } from './radio-studio'

export const dynamic = 'force-dynamic'

const PANEL_CATEGORIES = ['panels', 'hardwire_bp', 'wireless_bp']

export default async function PanelStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; equipmentId: string }>
  searchParams: Promise<{ review?: string; from?: string; radio?: string }>
}) {
  const { id, equipmentId } = await params
  const { review: reviewMemberId, from, radio: radioParam } = await searchParams
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

  // Get the assigned ProjectMember. Pull the per-show position +
  // department + location, AND the user's profile-level defaults — if
  // the per-show value is null we fall back to the User-level field
  // so the identity strip reads correctly even on projects where the
  // operator hasn't customised the per-show role.
  let member: {
    id: number
    userId: number
    firstName: string
    lastName: string
    position: string | null
    department: string | null
    location: string | null
  } | null = null

  if (equipment.assignedToId) {
    const pm = await prisma.projectMember.findUnique({
      where: { id: equipment.assignedToId },
      select: {
        id: true,
        userId: true,
        position: true,
        department: true,
        location: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            department: true,
          },
        },
      },
    })
    if (pm) {
      member = {
        id: pm.id,
        userId: pm.userId,
        firstName: pm.user.firstName,
        lastName: pm.user.lastName,
        // Per-show value wins; otherwise fall back to user profile.
        position: pm.position ?? pm.user.position ?? null,
        department: pm.department ?? pm.user.department ?? null,
        location: pm.location,
      }
    }
  }

  // Fetch PanelKey records for THIS equipment (if assigned). Keys are
  // equipment-scoped now — members with multiple panel-category devices
  // get one PanelKey row per device per slot.
  const panelKeysRaw = member
    ? await prisma.panelKey.findMany({
        where: { equipmentId: equipment.id },
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

  // Auto-sync PTP PickListItems from project members. Each member
  // gets exactly ONE PTP pick list entry so it has a real
  // PickListItem ID.
  //
  // Match case-insensitively so a name edit like "wyatt ortiz" →
  // "Wyatt Ortiz" doesn't create a duplicate PTP. Old casings of
  // the same member name (left behind by edits before this dedup
  // ran) are collapsed: keep one, delete the rest. Names that no
  // longer match any current member at all are also deleted as
  // orphans.
  const existingPtp = await prisma.pickListItem.findMany({
    where: { projectId, type: 'PTP' },
    select: { id: true, name: true },
  })
  // Bucket every existing PTP by its lowercase name so duplicates
  // (e.g. three "Wyatt Ortiz" rows in different casings) all land
  // in the same bucket and we can keep one + delete the rest.
  const existingByLower = new Map<string, typeof existingPtp>()
  for (const p of existingPtp) {
    const lower = p.name.toLowerCase()
    const arr = existingByLower.get(lower) ?? []
    arr.push(p)
    existingByLower.set(lower, arr)
  }

  const idsToDelete: number[] = []

  for (const m of ptpMembersRaw) {
    // Always store PTP names with proper casing so picker chips +
    // suggestion lists render `Wyatt Ortiz`, not whatever the user
    // typed at signup.
    const ptpName = `${m.user.firstName} ${m.user.lastName}`
    const lower = ptpName.toLowerCase()
    const matches = existingByLower.get(lower) ?? []
    if (matches.length === 0) {
      // No existing entry — create one.
      await prisma.pickListItem.create({
        data: { projectId, name: ptpName, type: 'PTP', code: m.position },
      })
    } else {
      // Keep the lowest-id row as the canonical one; collapse all
      // duplicates onto it.
      const [keep, ...dups] = matches
      if (keep.name !== ptpName) {
        await prisma.pickListItem.update({
          where: { id: keep.id },
          data: { name: ptpName, code: m.position },
        })
      }
      for (const d of dups) idsToDelete.push(d.id)
    }
    // Mark this bucket as consumed so the orphan pass below skips it.
    existingByLower.delete(lower)
  }

  // Anything left in `existingByLower` is an orphan — its name
  // doesn't match any current member. Delete those rows entirely.
  for (const arr of existingByLower.values()) {
    for (const p of arr) idsToDelete.push(p.id)
  }

  if (idsToDelete.length > 0) {
    await prisma.pickListItem.deleteMany({
      where: { id: { in: idsToDelete }, projectId, type: 'PTP' },
    })
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
        // Scope review to the equipment the admin opened — members with
        // multiple panel-category devices have one ChangeRequest per
        // device, so showing only this device's CRs is correct.
        equipmentId: equipment.id,
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

    // Bundle CRs by submitter so each person gets ONE push per
    // review session (not one per individual request). Tag dedup
    // on the device side also keeps reloads from stacking buzzes.
    // Fire-and-forget so a slow push service never delays the
    // page render.
    type ByCRSubmitter = Map<number, { projectId: number; ids: number[] }>
    const bySubmitter: ByCRSubmitter = new Map()
    for (const cr of rawCRs) {
      const existing = bySubmitter.get(cr.submittedById)
      if (existing) {
        existing.ids.push(cr.id)
      } else {
        bySubmitter.set(cr.submittedById, {
          projectId: cr.projectId,
          ids: [cr.id],
        })
      }
    }
    for (const [submitterId, group] of bySubmitter) {
      void notifyReviewStarted({
        submitterUserId: submitterId,
        reviewerUserId: session.user.id,
        changeRequestIds: group.ids,
        equipmentId: equipment.id,
        projectId: group.projectId,
      })
    }
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
        // Scope to THIS equipment — multi-device members shouldn't see
        // approval / rejection toasts for keys on a sibling device.
        equipmentId: equipment.id,
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

  // ─── Restore pending submitted state on revisit ───
  // When a user submits change requests, then navigates away and comes
  // back to this equipment, the green "submitted" border on their pending
  // keys must reappear. The ChangeRequestItem rows are the source of
  // truth: every item whose parent ChangeRequest is still unresolved
  // (status submitted / mgr_endorsed) marks a key slot the current user
  // has a pending request on.
  let pendingSubmittedSlots: Array<{
    keyIndex: number
    page: string
    expansion: number
    pickListItemId: number | null
    triggerMode: string | null
    talkMode: string | null
  }> = []
  if (member && isOwnPanel) {
    const pendingCRs = await prisma.changeRequest.findMany({
      where: {
        equipmentId: equipment.id,
        targetMemberId: member.id,
        submittedById: session.user.id,
        status: { in: ['submitted', 'mgr_endorsed'] },
      },
      select: {
        items: {
          select: {
            fieldChanged: true,
            newValue: true,
            panelKey: {
              select: { keyIndex: true, page: true, expansion: true },
            },
          },
        },
      },
    })
    // Collapse to one entry per slot — if multiple items target the same
    // key (e.g. pickListItem + triggerMode in the same submission), the
    // green border only needs to render once.
    const bySlot = new Map<string, {
      keyIndex: number
      page: string
      expansion: number
      pickListItemId: number | null
      triggerMode: string | null
      talkMode: string | null
    }>()
    for (const cr of pendingCRs) {
      for (const item of cr.items) {
        const k = item.panelKey
        const slotId = `${k.expansion}-${k.page}-${k.keyIndex}`
        const existing = bySlot.get(slotId) ?? {
          keyIndex: k.keyIndex,
          page: k.page,
          expansion: k.expansion,
          pickListItemId: null,
          triggerMode: null,
          talkMode: null,
        }
        if (item.fieldChanged === 'pickListItemId') {
          existing.pickListItemId = item.newValue ? parseInt(item.newValue) : null
        } else if (item.fieldChanged === 'triggerMode') {
          existing.triggerMode = item.newValue
        } else if (item.fieldChanged === 'talkMode') {
          existing.talkMode = item.newValue
        }
        bySlot.set(slotId, existing)
      }
    }
    pendingSubmittedSlots = Array.from(bySlot.values())
  }

  // Browse mode — when admin/manager arrives via My Equipment, fetch the
  // sibling data so we can render the project + user dropdowns, prev/next,
  // and a row of all the current member's gear at the top of the page.
  // Each browseable project carries a `firstEquipmentId` so the
  // project-switcher dropdown can navigate STRAIGHT to that project's
  // first panel-route (e.g. /projects/12/panel/8?from=my-equipment)
  // instead of bouncing through /my-equipment, which triggered an
  // extra server redirect and a visible blank flash on every switch.
  let browseProjects: Array<{ id: number; name: string; firstEquipmentId: number | null }> | undefined
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
  // Crew / user accounts also land here via /my-equipment now (they no
  // longer see the cards list). They get a project dropdown but no
  // member switcher — scoped to their own active projects with their
  // own first panel preloaded as `firstEquipmentId`.
  if (isBrowseEntry && !isManagerOrAdminGlobal) {
    const myMemberships = await prisma.projectMember.findMany({
      where: { userId: session.user.id, project: { status: 'active' } },
      select: { id: true, project: { select: { id: true, name: true } } },
    })
    const browseProjectsMap = new Map<number, { id: number; name: string }>()
    for (const m of myMemberships) {
      if (!browseProjectsMap.has(m.project.id)) {
        browseProjectsMap.set(m.project.id, { id: m.project.id, name: m.project.name })
      }
    }
    const memberIds = myMemberships.map((m) => m.id)
    // First panel-category equipment ASSIGNED TO THIS USER per project.
    const myEquipmentRows = memberIds.length === 0
      ? []
      : await prisma.equipment.findMany({
          where: {
            assignedToId: { in: memberIds },
            category: { in: PANEL_CATEGORIES },
          },
          select: { id: true, projectId: true, name: true },
          orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
        })
    const firstPanelByProject = new Map<number, number>()
    for (const r of myEquipmentRows) {
      if (!firstPanelByProject.has(r.projectId)) firstPanelByProject.set(r.projectId, r.id)
    }
    browseProjects = Array.from(browseProjectsMap.values())
      .map((p) => ({ ...p, firstEquipmentId: firstPanelByProject.get(p.id) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name))
    // No browseMembers — crew/user don't switch between people.
  } else if (isBrowseEntry && isManagerOrAdminGlobal) {
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
    const browseProjectIds = Array.from(browseProjectsMap.keys())

    // Resolve the first panel-category equipment for each project up
    // front so the project-switcher dropdown can navigate directly to
    // that project's panel page (skips the /my-equipment redirect).
    const PANEL_CATEGORIES = ['panels', 'hardwire_bp', 'wireless_bp']
    const firstPanelByProject = browseProjectIds.length === 0
      ? new Map<number, number>()
      : await (async () => {
          const rows = await prisma.equipment.findMany({
            where: {
              projectId: { in: browseProjectIds },
              category: { in: PANEL_CATEGORIES },
              assignedToId: { not: null },
            },
            select: { id: true, name: true, projectId: true },
            orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
          })
          const m = new Map<number, number>()
          for (const r of rows) {
            if (!m.has(r.projectId)) m.set(r.projectId, r.id)
          }
          return m
        })()

    browseProjects = Array.from(browseProjectsMap.values())
      .map((p) => ({ ...p, firstEquipmentId: firstPanelByProject.get(p.id) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name))

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

  }

  // Sibling gear — every equipment item AND every radio assigned to
  // the panel's current member, scoped to THIS project. Built outside
  // the browse-mode gate so the row also lights up on the user's own
  // panel studio when they have, e.g., a radio assigned next to their
  // panel. Radios surface as chips with category='radio'.
  if (member) {
    const [eqRows, radioRows] = await Promise.all([
      prisma.equipment.findMany({
        where: { projectId, assignedToId: member.id },
        select: { id: true, name: true, category: true, hardwareType: true },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      }),
      prisma.radio.findMany({
        where: { projectId, assignedToProjectMemberId: member.id },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])
    siblingGear = [
      ...eqRows,
      // Radios slot in at the end of the row, keyed by a synthetic
      // negative id so they can't collide with real equipment ids the
      // click handler uses to navigate. `category: 'radio'` triggers
      // the non-tappable variant in SiblingGearRow.
      ...radioRows.map((r) => ({
        id: -r.id,
        name: r.name,
        category: 'radio' as const,
        hardwareType: null as string | null,
      })),
    ]
  }

  // Radio-swap branch — when the sibling-gear chip click pushed
  // `?radio=<id>`, swap the chassis body for a zone list. We still
  // render the full panel-studio shell (project + member dropdowns,
  // prev/next, sibling-gear row) by delegating to RadioStudio, which
  // reuses the exported BrowseProjectDropdown / BrowseMemberSwitcher /
  // SiblingGearRow components.
  const activeRadioId = radioParam ? parseInt(radioParam, 10) : NaN
  if (Number.isFinite(activeRadioId)) {
    const [activeRadio, projectZones] = await Promise.all([
      prisma.radio.findUnique({
        where: { id: activeRadioId },
        select: {
          id: true,
          projectId: true,
          name: true,
          firstName: true,
          lastName: true,
          department: true,
          position: true,
        },
      }),
      prisma.zone.findMany({
        where: { projectId },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          channels: {
            orderBy: { channelIndex: 'asc' },
            select: { channelIndex: true, name: true },
          },
        },
      }),
    ])
    if (activeRadio && activeRadio.projectId === projectId) {
      return (
        <RadioStudio
          project={{ id: project.id, name: project.name }}
          equipment={{ id: equipment.id, name: equipment.name }}
          radio={{
            id: activeRadio.id,
            name: activeRadio.name,
            firstName: activeRadio.firstName,
            lastName: activeRadio.lastName,
            department: activeRadio.department,
            position: activeRadio.position,
          }}
          zones={projectZones.map((z) => ({
            id: z.id,
            name: z.name,
            channels: z.channels.map((c) => ({
              channelIndex: c.channelIndex,
              name: c.name,
            })),
          }))}
          browseProjects={browseProjects}
          browseMembers={browseMembers}
          siblingGear={siblingGear}
        />
      )
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
      pendingSubmittedSlots={pendingSubmittedSlots}
      recentResolutions={recentResolutions}
      browseProjects={browseProjects}
      browseMembers={browseMembers}
      siblingGear={siblingGear}
    />
  )
}
