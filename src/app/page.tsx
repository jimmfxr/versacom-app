import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'
import { EmptyState } from '@/components/empty-state'
import { ProjectDashboard, DashboardHeaderAction } from './project-dashboard'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const userName = `${session.user.firstName} ${session.user.lastName}`
  const isAdmin = session.memberships.some((m) => m.role === 'admin')
  const isUserOnly = session.memberships.every((m) => m.role === 'user')
  const showMyEquipment = session.memberships.some((m) => m.role === 'crew')

  // Users (no admin/manager/crew) don't get a dashboard — bounce them to My Equipment.
  if (isUserOnly) redirect('/my-equipment')

  // Build the dedupe list of projects this user belongs to (for the switcher).
  const userProjects = (() => {
    const seen = new Map<number, { id: number; name: string }>()
    for (const m of session.memberships) {
      if (!seen.has(m.project.id)) seen.set(m.project.id, { id: m.project.id, name: m.project.name })
    }
    return Array.from(seen.values())
  })()

  // No projects to show — empty state.
  if (userProjects.length === 0) {
    return (
      <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} showMyEquipment={showMyEquipment}>
        <PageLayout title="Dashboard">
          <EmptyState
            icon={null}
            title="No projects yet"
            message="You're not a member of any projects. Join one with a PIN to get started."
          />
        </PageLayout>
      </AppShell>
    )
  }

  // Resolve which project to show:
  // 1. ?project=<id> if it's one the user belongs to
  // 2. cookie from last selection
  // 3. otherwise the first one in their membership list
  const { project: projectParam } = await searchParams
  const requestedId = projectParam ? parseInt(projectParam, 10) : NaN
  const matchingProject = userProjects.find((p) => p.id === requestedId)

  let selectedProjectId: number
  if (matchingProject) {
    selectedProjectId = matchingProject.id
  } else {
    const cookieStore = await cookies()
    const cookieVal = cookieStore.get('selectedProject')?.value
    const cookieId = cookieVal ? parseInt(cookieVal, 10) : NaN
    const cookieProject = userProjects.find((p) => p.id === cookieId)
    selectedProjectId = cookieProject ? cookieProject.id : userProjects[0].id
  }

  // Fetch just the slice of data the dashboard needs.
  const [project, equipment, memberCount] = await Promise.all([
    prisma.project.findUnique({
      where: { id: selectedProjectId },
      select: { id: true, name: true },
    }),
    prisma.equipment.findMany({
      where: { projectId: selectedProjectId },
      select: {
        category: true,
        hardwareType: true,
        headsetType: true,
        location: true,
        deployStatus: true,
        assignedToId: true,
      },
    }),
    prisma.projectMember.count({ where: { projectId: selectedProjectId } }),
  ])

  if (!project) {
    // Shouldn't happen since selectedProjectId came from session, but bail safely.
    return (
      <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} showMyEquipment={showMyEquipment}>
        <PageLayout title="Dashboard">
          <EmptyState icon={null} title="Project not found" message="That project may have been deleted." />
        </PageLayout>
      </AppShell>
    )
  }

  return (
    <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} showMyEquipment={showMyEquipment}>
      <PageLayout
        title="Dashboard"
        action={
          <DashboardHeaderAction
            projectId={project.id}
            projectName={project.name}
            memberCount={memberCount}
            equipmentCount={equipment.length}
            userProjects={userProjects}
          />
        }
      >
        <ProjectDashboard equipment={equipment} />
      </PageLayout>
    </AppShell>
  )
}
