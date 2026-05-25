import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { MyEquipmentContent } from './my-equipment-content'

export const dynamic = 'force-dynamic'

export default async function MyEquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; member?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const userName = `${session.user.firstName} ${session.user.lastName}`
  const isUserOnly = session.memberships.every((m) => m.role === 'user')
  const isAdmin = session.memberships.some((m) => m.role === 'admin')

  // Pull all of the current user's project memberships fresh from the DB
  // (session.memberships is set at login and doesn't refresh).
  const myMemberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id, project: { status: 'active' } },
    select: {
      id: true,
      role: true,
      project: { select: { id: true, name: true } },
    },
  })

  // Determine if this user is admin/manager on at least one project — drives
  // whether the "browse mode" dropdowns render at the top of the page.
  const adminOrManagerProjects = myMemberships
    .filter((m) => m.role === 'admin' || m.role === 'manager')
    .map((m) => ({ id: m.project.id, name: m.project.name }))
  const adminOrManagerProjectsMap = new Map<number, { id: number; name: string }>()
  for (const p of adminOrManagerProjects) {
    if (!adminOrManagerProjectsMap.has(p.id)) adminOrManagerProjectsMap.set(p.id, p)
  }
  const browseProjects = Array.from(adminOrManagerProjectsMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const isBrowseMode = browseProjects.length > 0

  // Resolve which project + member we're browsing (admin/manager view).
  // URL params win when present; otherwise fall back to the last-browsed
  // values stored in cookies so navigating away and back lands the admin
  // right where they left off.
  const params = await searchParams
  const cookieStore = await cookies()
  // Prefer the shared `selectedProject` cookie (set by ProjectSwitcher on
  // Dashboard / Tasks / Admin) so picking a project anywhere carries here.
  // Fall back to `lastBrowseProject` for legacy session state written by
  // panel-studio when navigating between users in browse mode.
  const selectedProjectCookie = cookieStore.get('selectedProject')?.value
  const lastProjectCookie = cookieStore.get('lastBrowseProject')?.value
  const lastMemberCookie = cookieStore.get('lastBrowseMember')?.value
  const parseId = (raw: string | undefined | null) => {
    const n = raw ? parseInt(raw, 10) : NaN
    return Number.isFinite(n) ? n : null
  }
  const requestedProjectId =
    parseId(params.project) ??
    parseId(selectedProjectCookie) ??
    parseId(lastProjectCookie) ??
    null
  const requestedMemberId =
    parseId(params.member) ?? parseId(lastMemberCookie) ?? null

  // ──────────────────── BROWSE MODE (admin/manager) ────────────────────
  // Admin/manager skip the cards-list view entirely — we figure out the
  // first project / member / equipment and redirect straight to the panel
  // studio with ?from=my-equipment. Panel studio renders all the browse
  // controls (project + user dropdowns, prev/next, sibling-gear row), so
  // /my-equipment is just an entry point.
  if (isBrowseMode) {
    const PANEL_CATEGORIES = ['panels', 'hardwire_bp', 'wireless_bp']

    const selectedProjectId =
      requestedProjectId != null && adminOrManagerProjectsMap.has(requestedProjectId)
        ? requestedProjectId
        : browseProjects[0].id

    // If a specific member was requested in the URL, prefer them. Otherwise
    // pick the first member on the project who has any gear.
    const candidateMembers = await prisma.projectMember.findMany({
      where: { projectId: selectedProjectId, equipment: { some: {} } },
      select: {
        id: true,
        position: true,
        user: { select: { firstName: true, lastName: true } },
        equipment: {
          // `name` is the human ID like "PNL 1" / "WLBP 3" — surfaced
          // in the user dropdown so admins know which panel they're
          // about to switch to without reading the URL.
          select: { id: true, name: true, category: true },
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
        },
      },
    })

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    // One entry per (member × panel-category equipment) — multi-device
    // members appear once per device. Sorted by equipment ID so the
    // dropdown reads "PNL 1, PNL 2, …, WLBP 1, …" naturally. Non-panel
    // equipment categories are filtered out — the panel studio only
    // renders panels / hardwire / wireless beltpacks.
    const orderedMembers = candidateMembers
      .flatMap((m) =>
        m.equipment
          .filter((e) => PANEL_CATEGORIES.includes(e.category))
          .map((e) => ({
            // Use equipmentId as the entry's identity since each entry
            // is unique to one device.
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

    if (orderedMembers.length === 0) {
      // Project genuinely has no gear-having members. Fall through to the
      // empty state below so the admin can pick a different project.
      return (
        <MyEquipmentContent
          userName={userName}
          isAdmin={isAdmin}
          isUserOnly={isUserOnly}
          equipment={[]}
          browseProjects={browseProjects}
          selectedProjectId={selectedProjectId}
          browseMembers={[]}
          selectedMemberId={null}
        />
      )
    }

    // `requestedMemberId` from the URL still references projectMember.id
    // (the legacy ?member=X param). Find any entry for that member.
    // First match wins (entries are sorted by equipment ID, so a member's
    // lowest-numbered panel takes precedence — usually their primary).
    const targetMember =
      (requestedMemberId != null
        ? orderedMembers.find((m) => m.memberId === requestedMemberId)
        : null) ?? orderedMembers[0]

    redirect(
      `/projects/${selectedProjectId}/panel/${targetMember.equipmentId}?from=my-equipment`,
    )
  }

  // ──────────────────── SELF MODE (crew/user) ────────────────────
  // Crew / user accounts skip the cards-list view too: we resolve their
  // first panel-category equipment on their preferred project and redirect
  // straight into panel-studio. The header there renders a project
  // dropdown (in place of the back button) when more than one project has
  // their gear, mirroring the admin/manager browse flow but without the
  // member switcher (since they only see their own).
  const memberIds = myMemberships.map((m) => m.id)
  const PANEL_CATEGORIES_SELF = ['panels', 'hardwire_bp', 'wireless_bp']

  const equipment = await prisma.equipment.findMany({
    where: { assignedToId: { in: memberIds } },
    select: {
      id: true,
      name: true,
      category: true,
      hardwareType: true,
      location: true,
      headsetType: true,
      ipAddress: true,
      deployStatus: true,
      projectId: true,
    },
    orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
  })

  // Panel-category items only — radios / mults / etc. don't have a studio
  // page, so we route off the first panel/HWBP/WLBP.
  const panelEquipment = equipment.filter((e) =>
    PANEL_CATEGORIES_SELF.includes(e.category),
  )
  if (panelEquipment.length > 0) {
    const myProjectIds = new Set(myMemberships.map((m) => m.project.id))
    // Pick the project: URL ?project= wins, then selectedProject /
    // lastBrowseProject cookie, then the first project that actually has
    // some of their gear on it.
    const preferredProjectId =
      requestedProjectId != null && myProjectIds.has(requestedProjectId)
        ? requestedProjectId
        : null
    const targetEquipment =
      (preferredProjectId != null
        ? panelEquipment.find((e) => e.projectId === preferredProjectId)
        : null) ?? panelEquipment[0]

    redirect(
      `/projects/${targetEquipment.projectId}/panel/${targetEquipment.id}?from=my-equipment`,
    )
  }

  const projectMap: Record<number, string> = {}
  const roleMap: Record<number, string> = {}
  for (const m of myMemberships) {
    projectMap[m.project.id] = m.project.name
    roleMap[m.project.id] = m.role
  }

  const items = equipment.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    hardwareType: e.hardwareType,
    location: e.location,
    headsetType: e.headsetType,
    ipAddress: e.ipAddress,
    deployStatus: e.deployStatus,
    projectId: e.projectId,
    projectName: projectMap[e.projectId] || '',
    userRole: roleMap[e.projectId] || 'user',
  }))

  return (
    <MyEquipmentContent
      userName={userName}
      isAdmin={isAdmin}
      isUserOnly={isUserOnly}
      equipment={items}
    />
  )
}
