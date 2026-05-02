import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'
import { EmptyState } from '@/components/empty-state'
import { TaskCardList } from './task-card-list'

function CheckIcon() {
  return (
    <svg className="size-12 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

export const dynamic = 'force-dynamic'

const ASSIGNABLE_CATEGORIES = ['panels', 'wireless_bp', 'hardwire_bp']
const INFRA_CATEGORIES = ['switches', 'antennas', 'audio']

export default async function TasksPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const userName = `${session.user.firstName} ${session.user.lastName}`
  const isAdmin = session.memberships.some((m) => m.role === 'admin')
  const isUserOnly = session.memberships.every((m) => m.role === 'user')
  const showMyEquipment = session.memberships.some((m) => m.role === 'crew')

  if (isUserOnly) redirect('/my-equipment')

  // Pull all projects the user belongs to so we can scope the task list.
  const memberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id, project: { status: 'active' } },
    select: { projectId: true },
  })
  const projectIds = Array.from(new Set(memberships.map((m) => m.projectId)))

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

  // Cards = the actionable subset (deployStatus='na' AND planned).
  const cards = allGear.filter((e) => {
    if (e.deployStatus !== 'na') return false
    if (ASSIGNABLE_CATEGORIES.includes(e.category)) return e.assignedToId != null
    if (INFRA_CATEGORIES.includes(e.category)) return !!(e.location && e.location.trim())
    return false
  })

  // Distinct location chips — sorted alphabetically.
  const locations = Array.from(
    new Set(allGear.map((g) => g.effectiveLocation).filter((l): l is string => !!l)),
  ).sort()

  return (
    <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} showMyEquipment={showMyEquipment}>
      <PageLayout
        title="Tasks"
        titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
      >
        {cards.length === 0 ? (
          <EmptyState
            icon={<CheckIcon />}
            title="Inbox zero"
            message="No equipment waiting to be deployed. New tasks show up here as gear gets assigned or located."
          />
        ) : (
          <TaskCardList tasks={cards} allGear={allGear} locations={locations} />
        )}
      </PageLayout>
    </AppShell>
  )
}
