'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

/**
 * Update a single switch port's VLAN profile / trunk flag.
 *
 * Auth: project member with role in (admin | crew). Managers are
 * view-only (matches the operator's stated role gating); users are
 * blocked by the proxy before they could even reach this surface,
 * but we still hard-check on the server.
 *
 * Profile resolution: the client passes a `profileId` (FK on the
 * VlanProfile table) OR null to unassign. `isTrunk` is independent
 * of the profile — a trunk port with a profileId set will still
 * render gray + T badge on the chassis; the underlying profile is
 * preserved for round-tripping.
 */
export async function updateSwitchPort(input: {
  projectId: number
  equipmentId: number
  portId: number
  profileId: number | null
  isTrunk: boolean
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession()
  if (!session) return { error: 'Unauthorized' }

  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId: input.projectId },
    select: { role: true },
  })
  if (!membership) return { error: 'Forbidden' }
  // Manager is view-only on Switch Studio per the operator decision.
  if (!['admin', 'crew'].includes(membership.role)) {
    return { error: 'Read-only role' }
  }

  // Ensure the port belongs to a switch on this project — defence
  // against a crafted request pointing at someone else's gear.
  const port = await prisma.switchPort.findFirst({
    where: {
      id: input.portId,
      equipmentId: input.equipmentId,
      equipment: { projectId: input.projectId, category: 'switches' },
    },
    select: { id: true },
  })
  if (!port) return { error: 'Port not found' }

  // Validate the profile exists if one was passed. Null is fine
  // (unassign the port).
  if (input.profileId != null) {
    const profile = await prisma.vlanProfile.findUnique({
      where: { id: input.profileId },
      select: { id: true },
    })
    if (!profile) return { error: 'Profile not found' }
  }

  await prisma.switchPort.update({
    where: { id: input.portId },
    data: {
      profileId: input.profileId,
      isTrunk: input.isTrunk,
    },
  })

  revalidatePath(`/projects/${input.projectId}/switch/${input.equipmentId}`)
  return { ok: true }
}
