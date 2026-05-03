import { redirect } from 'next/navigation'
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
  const params = await searchParams
  const requestedProjectId = params.project ? parseInt(params.project, 10) : null
  const requestedMemberId = params.member ? parseInt(params.member, 10) : null

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
          select: { id: true, category: true },
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
        },
      },
    })

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    const orderedMembers = candidateMembers
      .map((m) => {
        const panel = m.equipment.find((e) => PANEL_CATEGORIES.includes(e.category))
        const firstEq = panel ?? m.equipment[0]
        return {
          id: m.id,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          position: m.position,
          displayName: `${m.user.firstName} ${m.user.lastName}`.trim(),
          equipmentId: firstEq?.id ?? null,
        }
      })
      .filter((m) => m.equipmentId != null)
      .sort((a, b) => {
        const byName = collator.compare(a.displayName, b.displayName)
        if (byName !== 0) return byName
        return collator.compare(a.position ?? '', b.position ?? '')
      })

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

    const targetMember =
      (requestedMemberId != null
        ? orderedMembers.find((m) => m.id === requestedMemberId)
        : null) ?? orderedMembers[0]

    redirect(
      `/projects/${selectedProjectId}/panel/${targetMember.equipmentId}?from=my-equipment`,
    )
  }

  // ──────────────────── SELF MODE (crew/user) ────────────────────
  const memberIds = myMemberships.map((m) => m.id)

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
