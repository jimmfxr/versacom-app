'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { FRAME_MODELS, type CardType } from '@/lib/frame-models'

/**
 * Update a single Frame Studio bay's card type.
 *
 * Auth + role gating mirrors Switch Studio's `updateSwitchPort`:
 *   - session required
 *   - membership on this project required
 *   - manager view-only (server-side enforcement matches the client
 *     `canEdit` flag; user-role is blocked at the proxy)
 *
 * Card-type validation: the operator can only pick from
 * `FrameBay.allowedCards` — server-side re-check makes a crafted
 * request (e.g. assigning a CPU card to a data bay) impossible. The
 * frame's hardwareType resolves to a FrameModel; the bay matches by
 * its `bayKey` (string label like "1", "A", "X"); the bay's
 * allowedCards is the source of truth.
 */
export async function updateFrameSlot(input: {
  projectId: number
  equipmentId: number
  slotId: number
  cardType: string
  notes?: string | null
}): Promise<{ ok: true } | { error: string }> {
  const session = await getSession()
  if (!session) return { error: 'Unauthorized' }

  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId: input.projectId },
    select: { role: true },
  })
  if (!membership) return { error: 'Forbidden' }
  // Manager is view-only on Frame Studio per the operator decision —
  // same gating as Switch Studio.
  if (!['admin', 'crew'].includes(membership.role)) {
    return { error: 'Read-only role' }
  }

  // Resolve the slot + its parent equipment in one shot so we can
  // confirm both ownership (defence against a crafted projectId vs
  // equipmentId mismatch) and the allowed-card whitelist.
  const slot = await prisma.frameSlot.findFirst({
    where: {
      id: input.slotId,
      equipmentId: input.equipmentId,
      equipment: { projectId: input.projectId, category: 'frames' },
    },
    select: {
      id: true,
      bayKey: true,
      equipment: { select: { hardwareType: true } },
    },
  })
  if (!slot) return { error: 'Slot not found' }

  const model = FRAME_MODELS[slot.equipment.hardwareType ?? '']
  if (!model) return { error: 'Frame model not registered' }
  const bay = model.bays.find((b) => b.key === slot.bayKey)
  if (!bay) return { error: 'Bay not in model' }
  if (!bay.allowedCards.includes(input.cardType as CardType)) {
    return { error: 'Card type not allowed in this bay' }
  }

  await prisma.frameSlot.update({
    where: { id: input.slotId },
    data: {
      cardType: input.cardType,
      // notes is optional — operator may not touch it. Only set when
      // the input includes it (undefined leaves the column alone).
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  })

  revalidatePath(`/projects/${input.projectId}/frame/${input.equipmentId}`)
  return { ok: true }
}
