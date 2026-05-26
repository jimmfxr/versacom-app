import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { RadiosPage } from './radios-page'

export const dynamic = 'force-dynamic'

/**
 * /radios — top-level Radios surface. Same project-switcher pattern as
 * Tasks / Notifications: URL `?project=` wins over `selectedProject`
 * cookie. When neither resolves to a project the user belongs to, fall
 * back to the first (alphabetical) project so the page never lands on
 * a project the viewer can't see.
 *
 * Phase-1 scope: admin / manager only. The nav item is gated to those
 * two roles too. User / crew get the zone cards on /my-equipment
 * (phase 4 — not this surface). Non-editors hitting /radios directly
 * are bounced.
 */
export default async function RadiosRoute({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const params = await searchParams
  const urlProjectId = params.project ? parseInt(params.project, 10) : NaN
  const cookieStore = await cookies()
  const cookieRaw = cookieStore.get('selectedProject')?.value
  const cookieProjectId = cookieRaw ? parseInt(cookieRaw, 10) : NaN

  // Pull every active project the user belongs to — feeds the project
  // switcher dropdown.
  const memberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id, project: { status: 'active' } },
    select: {
      role: true,
      project: { select: { id: true, name: true, pin: true } },
    },
  })
  const userProjectsMap = new Map<number, { id: number; name: string; pin: string | null }>()
  const adminProjectIds = new Set<number>()
  const editableProjectIds = new Set<number>()
  for (const m of memberships) {
    if (!userProjectsMap.has(m.project.id)) {
      userProjectsMap.set(m.project.id, {
        id: m.project.id,
        name: m.project.name,
        pin: m.project.pin,
      })
    }
    if (m.role === 'admin') adminProjectIds.add(m.project.id)
    if (m.role === 'admin' || m.role === 'manager') editableProjectIds.add(m.project.id)
  }
  const isGlobalAdmin = adminProjectIds.size > 0
  const userProjects = Array.from(userProjectsMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )

  // No active project memberships → nothing to show. Send the user to
  // the projects list so they can find / create one.
  if (userProjects.length === 0) redirect('/projects')

  const resolved = Number.isFinite(urlProjectId)
    ? urlProjectId
    : Number.isFinite(cookieProjectId)
      ? cookieProjectId
      : null
  const filteredProjectId =
    resolved != null && userProjects.some((p) => p.id === resolved)
      ? resolved
      : userProjects[0].id

  // Can the viewer edit radios on THIS project?
  // Admin on any project → yes (global admin).
  // Otherwise check the per-project membership.
  const canEdit = isGlobalAdmin || editableProjectIds.has(filteredProjectId)

  // Phase-1: only admin/manager can see /radios at all. User + crew
  // get the zone cards on /my-equipment (phase 4). Bounce here so
  // there's no read-only mode to maintain.
  if (!canEdit) redirect('/my-equipment')

  // Pull radios for the selected project plus the project's team
  // members (for the autocomplete in the edit card). Department list
  // is global across all projects, mirroring the team-tab pattern.
  // Zones + their channel rows + radio↔zone links are pulled in one
  // pass so the Radio Channels tab + radio edit card both have what
  // they need.
  const [radioRows, projectMembers, departmentRows, zoneRows] = await Promise.all([
    prisma.radio.findMany({
      where: { projectId: filteredProjectId },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        department: true,
        position: true,
        barcode: true,
        status: true,
        assignedToProjectMemberId: true,
        fistMic: true,
        surveillance: true,
        doubleMuff: true,
        lightweight: true,
        zones: { select: { zoneId: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.projectMember.findMany({
      where: { projectId: filteredProjectId },
      select: {
        id: true,
        position: true,
        department: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.projectMember.findMany({
      where: { department: { not: null } },
      select: { department: true },
      distinct: ['department'],
    }),
    prisma.zone.findMany({
      where: { projectId: filteredProjectId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        order: true,
        channels: {
          orderBy: { channelIndex: 'asc' },
          select: { id: true, channelIndex: true, name: true },
        },
      },
    }),
  ])

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  // Flatten the zones join shape: client just needs the zone ids per
  // radio for the picker checkboxes.
  const radios = radioRows
    .map((r) => ({
      id: r.id,
      name: r.name,
      firstName: r.firstName,
      lastName: r.lastName,
      department: r.department,
      position: r.position,
      barcode: r.barcode,
      status: r.status,
      assignedToProjectMemberId: r.assignedToProjectMemberId,
      fistMic: r.fistMic,
      surveillance: r.surveillance,
      doubleMuff: r.doubleMuff,
      lightweight: r.lightweight,
      zoneIds: r.zones.map((z) => z.zoneId),
    }))
    .sort((a, b) => collator.compare(a.name, b.name))

  const teamMembers = projectMembers
    .map((m) => ({
      id: m.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      department: m.department,
      position: m.position,
    }))
    .sort((a, b) => collator.compare(`${a.firstName} ${a.lastName}`, `${b.firstName} ${b.lastName}`))

  const departmentSuggestions = Array.from(
    new Set(departmentRows.map((d) => d.department?.trim() ?? '').filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))

  return (
    <RadiosPage
      projectId={filteredProjectId}
      userProjects={userProjects}
      radios={radios}
      teamMembers={teamMembers}
      departmentSuggestions={departmentSuggestions}
      zones={zoneRows}
    />
  )
}
