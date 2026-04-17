import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { PanelStudio } from './panel-studio'

const PANEL_CATEGORIES = ['panels', 'hardwire_bp', 'wireless_bp']

export default async function PanelStudioPage({
  params,
}: {
  params: Promise<{ id: string; equipmentId: string }>
}) {
  const { id, equipmentId } = await params
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
    pickListItemId: k.pickListItemId,
    pickListItemName: k.pickListItem?.name ?? null,
    pickListItemType: k.pickListItem?.type ?? null,
  }))

  // Fetch all ProjectMembers for PTP entries
  const ptpMembersRaw = await prisma.projectMember.findMany({
    where: { projectId },
    select: {
      id: true,
      position: true,
      user: { select: { firstName: true, lastName: true } },
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

  // Fetch PickListItem records for the project (including newly created PTP items)
  const pickListItems = await prisma.pickListItem.findMany({
    where: { projectId },
    select: { id: true, code: true, name: true, type: true },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })

  const ptpMembers = ptpMembersRaw.map((m) => ({
    id: m.id,
    name: `${m.user.firstName} ${m.user.lastName}`,
    position: m.position,
  }))

  // Get project info
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  })

  if (!project) notFound()

  // Get session user's membership for permissions
  const currentMembership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId },
    select: { id: true, role: true },
  })

  const currentUserRole = currentMembership?.role || 'user'
  const isAdmin = currentUserRole === 'admin'
  const isManager = currentUserRole === 'manager'
  const isCrew = currentUserRole === 'crew'

  // canEditKeys: admin=always, crew=own panel only, manager=any panel (request mode)
  // Check both membership ID match AND userId match as fallback for robustness
  const isOwnPanel = member !== null && (
    currentMembership?.id === member.id ||
    member.userId === session.user.id
  )
  const canEditKeys =
    isAdmin ||
    isManager ||
    (isCrew && isOwnPanel)

  // canManageExpansions: admin only
  const canManageExpansions = isAdmin

  // showIpAddress: admin, manager, crew can see it; user cannot
  const showIpAddress = isAdmin || isManager || isCrew

  // isRequestMode: true for crew and manager (changes go through approval); false for admin
  const isRequestMode = !isAdmin && (isCrew || isManager)

  const isAdminGlobal = session.memberships.some((m) => m.role === 'admin')
  const isUserOnly = session.memberships.every((m) => m.role === 'user')
  const userName = `${session.user.firstName} ${session.user.lastName}`

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
    />
  )
}
