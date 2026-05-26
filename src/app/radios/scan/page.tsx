import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { ScanContent } from './scan-content'

export const dynamic = 'force-dynamic'

/**
 * /radios/scan — admin/manager-only barcode scanner. Routes back to
 * /radios when permissions don't check out (matches the radios-page
 * server-side gate). The actual camera + decode logic lives in the
 * client component; this server file just resolves the active project
 * + member / department suggestions for the assignment modal.
 */
export default async function RadiosScanRoute({
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

  // Eligible projects — same shape as /radios: every active project the
  // user is admin/manager on.
  const memberships = await prisma.projectMember.findMany({
    where: {
      userId: session.user.id,
      project: { status: 'active' },
    },
    select: { role: true, project: { select: { id: true, name: true } } },
  })
  const editableProjectIds = new Set<number>()
  for (const m of memberships) {
    if (m.role === 'admin' || m.role === 'manager') editableProjectIds.add(m.project.id)
  }
  const isGlobalAdmin = memberships.some((m) => m.role === 'admin')

  if (memberships.length === 0) redirect('/projects')

  // Resolve which project to scan against. URL wins, then cookie, then
  // the first editable project the user has.
  const resolved = Number.isFinite(urlProjectId)
    ? urlProjectId
    : Number.isFinite(cookieProjectId)
      ? cookieProjectId
      : null
  const candidateIds = Array.from(
    new Set(memberships.filter((m) => m.role === 'admin' || m.role === 'manager').map((m) => m.project.id)),
  )
  const filteredProjectId =
    resolved != null && (editableProjectIds.has(resolved) || isGlobalAdmin)
      ? resolved
      : candidateIds[0] ?? null

  if (filteredProjectId == null) redirect('/radios')

  // Same admin/manager gate as the /radios route — bounce non-editors
  // out so user/crew can't ever land here.
  const canEdit = isGlobalAdmin || editableProjectIds.has(filteredProjectId)
  if (!canEdit) redirect('/my-equipment')

  const project = await prisma.project.findUnique({
    where: { id: filteredProjectId },
    select: { id: true, name: true },
  })
  if (!project) redirect('/radios')

  // Team members for the assignment-modal autocomplete + department
  // suggestions (mirrors the radios-page server load).
  const [projectMembers, departmentRows] = await Promise.all([
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
  ])

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const teamMembers = projectMembers
    .map((m) => ({
      id: m.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      department: m.department,
      position: m.position,
    }))
    .sort((a, b) =>
      collator.compare(`${a.firstName} ${a.lastName}`, `${b.firstName} ${b.lastName}`),
    )

  const departmentSuggestions = Array.from(
    new Set(departmentRows.map((d) => d.department?.trim() ?? '').filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))

  return (
    <ScanContent
      project={project}
      teamMembers={teamMembers}
      departmentSuggestions={departmentSuggestions}
    />
  )
}
