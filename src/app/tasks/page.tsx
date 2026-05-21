import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { TasksPageClient } from './tasks-page-client'

export const dynamic = 'force-dynamic'

const ASSIGNABLE_CATEGORIES = ['panels', 'wireless_bp', 'hardwire_bp']
// Mults are infrastructure too — they get placed at locations, need
// deploying / returning, and don't have a single assignee.
const INFRA_CATEGORIES = ['switches', 'antennas', 'audio', 'mults']

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const params = await searchParams
  const urlProjectId = params.project ? parseInt(params.project, 10) : NaN
  // Fall back to the shared `selectedProject` cookie that ProjectSwitcher
  // writes from Dashboard / Tasks so picking a project on one page carries
  // over to the other. Without this, Tasks always defaulted to the first
  // alphabetical project regardless of what the user picked on Dashboard.
  const cookieStore = await cookies()
  const cookieRaw = cookieStore.get('selectedProject')?.value
  const cookieProjectId = cookieRaw ? parseInt(cookieRaw, 10) : NaN
  const filteredProjectId = Number.isFinite(urlProjectId)
    ? urlProjectId
    : Number.isFinite(cookieProjectId)
      ? cookieProjectId
      : null

  const isUserOnly = session.memberships.every((m) => m.role === 'user')
  if (isUserOnly) redirect('/my-equipment')

  // Pull all projects the user belongs to so we can scope the task list and
  // populate the top-right project switcher.
  const memberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id, project: { status: 'active' } },
    select: {
      projectId: true,
      project: { select: { id: true, name: true, returnPhaseActive: true } },
    },
  })
  // Project IDs where return phase is currently active — controls whether
  // "done" items show up as Return tasks on the page.
  const returnPhaseProjectIds = new Set(
    memberships.filter((m) => m.project.returnPhaseActive).map((m) => m.projectId),
  )
  // De-dup project list (a user can have multiple memberships per project).
  const userProjectsMap = new Map<number, { id: number; name: string }>()
  for (const m of memberships) {
    if (!userProjectsMap.has(m.project.id)) {
      userProjectsMap.set(m.project.id, { id: m.project.id, name: m.project.name })
    }
  }
  const userProjects = Array.from(userProjectsMap.values()).sort((a, b) => a.name.localeCompare(b.name))

  // ?project= filter — defaults to the first project if absent or invalid.
  // No "All shows" option here; the page always scopes to one project.
  const validFilteredId =
    filteredProjectId != null && userProjectsMap.has(filteredProjectId)
      ? filteredProjectId
      : userProjects.length > 0
        ? userProjects[0].id
        : null
  const projectIds = validFilteredId != null ? [validFilteredId] : []

  // We pull every piece of equipment in the user's projects (not just the
  // not-yet-deployed ones) because the location filter on the client needs
  // the full picture to render its summary cards. The "actionable task"
  // filter is applied client-side from the same dataset.
  const equipment = projectIds.length === 0
    ? []
    : await prisma.equipment.findMany({
        where: { projectId: { in: projectIds } },
        select: {
          id: true,
          name: true,
          category: true,
          hardwareType: true,
          headsetType: true,
          location: true,
          ipAddress: true,
          assignedToId: true,
          deployStatus: true,
          projectId: true,
          gooseneck: true,
          footswitches: true,
          speakers: true,
          project: { select: { name: true } },
          assignedTo: {
            select: {
              user: { select: { firstName: true, lastName: true } },
              position: true,
              location: true,
            },
          },
        },
        orderBy: [{ projectId: 'asc' }, { category: 'asc' }, { hardwareType: 'asc' }],
      })

  // Stage plots for the projects this user has access to. Lets the
  // crew Pull-list card surface the matching PDF chip per location.
  const plotRows = projectIds.length === 0
    ? []
    : await prisma.plot.findMany({
        where: { projectId: { in: projectIds } },
        select: { id: true, label: true, url: true, projectId: true },
      })

  // Resolve "effective location" for each piece of gear. Equipment's own
  // location wins; for assignable gear that has no equipment-level location
  // set, we fall back to the assigned user's location. The key is *location* —
  // any gear with one shows up under that chip, with or without a user.
  const allGear = equipment.map((e) => {
    const ownLocation = e.location?.trim() || null
    const userLocation = e.assignedTo?.location?.trim() || null
    const effectiveLocation = ownLocation || userLocation
    return {
      id: e.id,
      name: e.name ?? '',
      category: e.category,
      hardwareType: e.hardwareType,
      headsetType: e.headsetType,
      location: e.location,
      effectiveLocation,
      ipAddress: e.ipAddress,
      deployStatus: e.deployStatus,
      assignedToId: e.assignedToId,
      gooseneck: e.gooseneck,
      footswitches: e.footswitches,
      speakers: e.speakers,
      projectId: e.projectId,
      projectName: e.project.name,
      assignedTo:
        e.assignedTo && e.assignedTo.user
          ? {
              name: `${e.assignedTo.user.firstName} ${e.assignedTo.user.lastName}`,
              position: e.assignedTo.position ?? null,
            }
          : null,
    }
  })

  // Deploy cards = na items that are planned (assigned or located).
  // Skipped entirely when the project's in return phase — those
  // NA items roll into the Return queue instead so crew gets ONE
  // accounting task per piece, not two.
  const deployCards = allGear
    .filter((e) => {
      if (returnPhaseProjectIds.has(e.projectId)) return false
      if (e.deployStatus !== 'na') return false
      // Wireless beltpacks are deliberately excluded from deploy
      // tasks — they aren't deployed through this flow, so showing
      // them here just clutters the crew list.
      if (e.category === 'wireless_bp') return false
      if (ASSIGNABLE_CATEGORIES.includes(e.category)) return e.assignedToId != null
      if (INFRA_CATEGORIES.includes(e.category)) return !!(e.location && e.location.trim())
      return false
    })
    .map((e) => ({ ...e, mode: 'deploy' as const }))

  // Return cards = anything not yet RETURNED (and not DAMAGED) in
  // projects whose admin has activated the Return phase. Includes
  // NA gear too — at end of show, crew should account for every
  // piece of planned equipment, even ones that never left the case.
  // DAMAGED is excluded because flipping it to RETURNED would erase
  // the broken-gear flag silently; admin handles those manually.
  // Same "planned" eligibility as deploy.
  const returnCards = allGear
    .filter((e) => {
      if (!returnPhaseProjectIds.has(e.projectId)) return false
      if (e.deployStatus === 'returned' || e.deployStatus === 'damaged') return false
      if (ASSIGNABLE_CATEGORIES.includes(e.category)) return e.assignedToId != null
      if (INFRA_CATEGORIES.includes(e.category)) return !!(e.location && e.location.trim())
      return false
    })
    .map((e) => ({ ...e, mode: 'return' as const }))

  const cards = [...deployCards, ...returnCards]

  // Distinct location chips — sorted alphabetically.
  const locations = Array.from(
    new Set(allGear.map((g) => g.effectiveLocation).filter((l): l is string => !!l)),
  ).sort()

  // Filter plots to whichever project the user is currently looking at
  // (the dropdown switcher value). If they're viewing "All shows"
  // (validFilteredId === null), include every plot — but in practice
  // the LocationSummary uses label-match so collisions are unlikely.
  const visiblePlots = validFilteredId == null
    ? plotRows
    : plotRows.filter((p) => p.projectId === validFilteredId)

  return (
    <TasksPageClient
      cards={cards}
      allGear={allGear}
      locations={locations}
      userProjects={userProjects}
      validFilteredId={validFilteredId}
      selectedProjectName={validFilteredId != null ? (userProjectsMap.get(validFilteredId)?.name ?? null) : null}
      plots={visiblePlots.map((p) => ({ id: p.id, label: p.label, url: p.url }))}
    />
  )
}
