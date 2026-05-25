'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { parseStartingName } from '@/lib/sequence-id'

/**
 * Auth helper: must be admin or manager on the target project (or a
 * global admin somewhere). Mirrors the gate used by the team-edit and
 * equipment-edit actions on Project Details.
 */
async function canEditRadios(userId: number, projectId: number): Promise<boolean> {
  const [membership, globalAdmin] = await Promise.all([
    prisma.projectMember.findFirst({
      where: { projectId, userId },
      select: { role: true },
    }),
    prisma.projectMember.findFirst({
      where: { userId, role: 'admin' },
      select: { id: true },
    }),
  ])
  if (globalAdmin) return true
  return membership?.role === 'admin' || membership?.role === 'manager'
}

const MAX_TEXT = 60
const MAX_BARCODE = 80
const MAX_BULK_QUANTITY = 200

/**
 * Bulk-create blank radios with auto-generated IDs. Same sequence
 * generator the Equipment bulk-add uses, so the same letter / dotted /
 * integer suffix shorthand works ("RAD 1", "A 4.01", "Z", etc.).
 *
 * Radios are created unassigned — operator fills in name / barcode /
 * etc. afterwards via the edit card. Collisions with existing names
 * are skipped (loop walks the sequence further) up to a safety cap.
 */
export async function bulkCreateRadios(
  projectId: number,
  quantity: number,
  startingId: string = '',
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await canEditRadios(session.user.id, projectId))) {
    return { error: 'Not authorized to manage radios on this project' }
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BULK_QUANTITY) {
    return { error: `Quantity must be between 1 and ${MAX_BULK_QUANTITY}` }
  }

  // Resolve the name generator. Blank → "RAD <next>" sequence picking
  // up from the highest existing trailing integer; typed value → run
  // it through the shared parser.
  const trimmedStartingId = startingId.trim()
  let nameAt: (i: number) => string
  if (trimmedStartingId) {
    const parsed = parseStartingName(trimmedStartingId)
    if (!parsed) {
      return {
        error:
          'Starting ID must end in letters (A, FOH A), digits (RAD 1, R001), or a dotted number (A 4.01).',
      }
    }
    nameAt = parsed.at
  } else {
    const existing = await prisma.radio.findMany({
      where: { projectId },
      select: { name: true },
    })
    let maxNum = 0
    for (const r of existing) {
      const m = r.name.match(/^RAD\s+(\d+)$/)
      if (m) {
        const n = parseInt(m[1], 10)
        if (n > maxNum) maxNum = n
      }
    }
    const startNum = maxNum + 1
    nameAt = (i) => `RAD ${startNum + i}`
  }

  // Snapshot existing names so the loop can skip collisions.
  const existingNames = new Set(
    (await prisma.radio.findMany({ where: { projectId }, select: { name: true } })).map(
      (r) => r.name,
    ),
  )

  const records: { projectId: number; name: string }[] = []
  const maxIterations = quantity * 10 + 10
  let i = 0
  while (records.length < quantity && i < maxIterations) {
    const name = nameAt(i)
    if (!existingNames.has(name)) {
      records.push({ projectId, name })
      existingNames.add(name)
    }
    i++
  }

  if (records.length < quantity) {
    return { error: 'Too many collisions in the requested range. Pick a different starting ID.' }
  }

  await prisma.radio.createMany({ data: records })
  revalidatePath('/radios')
  return { success: true, count: records.length }
}

function clip(s: string | null | undefined, max: number): string | null {
  if (s == null) return null
  const v = s.trim()
  if (v.length === 0) return null
  return v.slice(0, max)
}

/**
 * Update one radio. All non-undefined fields are written, name + ID
 * collision is checked.
 *
 * `assignedToProjectMemberId` is a free-form input — the caller can
 * pass null to clear the link, or a ProjectMember id picked from
 * autosuggest. We don't enforce that the FK matches the typed name —
 * the snapshot fields stay authoritative for display.
 */
export async function updateRadio(
  radioId: number,
  data: {
    name?: string
    firstName?: string | null
    lastName?: string | null
    department?: string | null
    position?: string | null
    barcode?: string | null
    assignedToProjectMemberId?: number | null
    fistMic?: boolean
    surveillance?: boolean
    doubleMuff?: boolean
    lightweight?: boolean
  },
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const radio = await prisma.radio.findUnique({
    where: { id: radioId },
    select: { projectId: true },
  })
  if (!radio) return { error: 'Radio not found' }
  if (!(await canEditRadios(session.user.id, radio.projectId))) {
    return { error: 'Not authorized to edit this radio' }
  }

  const update: {
    name?: string
    firstName?: string | null
    lastName?: string | null
    department?: string | null
    position?: string | null
    barcode?: string | null
    assignedToProjectMemberId?: number | null
    fistMic?: boolean
    surveillance?: boolean
    doubleMuff?: boolean
    lightweight?: boolean
  } = {}

  if (data.name !== undefined) {
    const v = data.name.trim()
    if (!v) return { error: 'ID is required' }
    if (v.length > MAX_TEXT) return { error: 'ID too long' }
    // Block collisions inside the same project.
    const dupe = await prisma.radio.findFirst({
      where: { projectId: radio.projectId, name: v, NOT: { id: radioId } },
      select: { id: true },
    })
    if (dupe) return { error: `Another radio is already using ID "${v}"` }
    update.name = v
  }
  if (data.firstName !== undefined) update.firstName = clip(data.firstName, MAX_TEXT)
  if (data.lastName !== undefined) update.lastName = clip(data.lastName, MAX_TEXT)
  if (data.department !== undefined) update.department = clip(data.department, MAX_TEXT)
  if (data.position !== undefined) update.position = clip(data.position, MAX_TEXT)
  if (data.barcode !== undefined) update.barcode = clip(data.barcode, MAX_BARCODE)
  if (data.assignedToProjectMemberId !== undefined) {
    update.assignedToProjectMemberId = data.assignedToProjectMemberId
  }
  if (data.fistMic !== undefined) update.fistMic = data.fistMic
  if (data.surveillance !== undefined) update.surveillance = data.surveillance
  if (data.doubleMuff !== undefined) update.doubleMuff = data.doubleMuff
  if (data.lightweight !== undefined) update.lightweight = data.lightweight

  await prisma.radio.update({ where: { id: radioId }, data: update })
  revalidatePath('/radios')
  return { success: true }
}

/**
 * Replace the set of zones a radio is in with the provided list. Used
 * by the zones-picker in the radio edit card — passing an empty array
 * detaches the radio from every zone. Authorises against the radio's
 * project just like updateRadio() does.
 */
export async function setRadioZones(radioId: number, zoneIds: number[]) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const radio = await prisma.radio.findUnique({
    where: { id: radioId },
    select: { projectId: true },
  })
  if (!radio) return { error: 'Radio not found' }
  if (!(await canEditRadios(session.user.id, radio.projectId))) {
    return { error: 'Not authorized to edit this radio' }
  }

  // Only allow linking to zones within the SAME project — guards
  // against a stale id from a different show silently slipping in.
  const validZones = await prisma.zone.findMany({
    where: { id: { in: zoneIds }, projectId: radio.projectId },
    select: { id: true },
  })
  const validIds = validZones.map((z) => z.id)

  await prisma.$transaction([
    prisma.radioZone.deleteMany({ where: { radioId } }),
    ...(validIds.length > 0
      ? [
          prisma.radioZone.createMany({
            data: validIds.map((zoneId) => ({ radioId, zoneId })),
          }),
        ]
      : []),
  ])

  revalidatePath('/radios')
  return { success: true }
}

const MAX_ZONE_NAME = 60
const MAX_CHANNEL_NAME = 60
const ZONE_CHANNEL_COUNT = 16

/**
 * Create a fresh zone with all 16 channel rows pre-seeded blank so the
 * UI immediately has stable channel IDs to bind text inputs against.
 * `order` defaults to the next position so a freshly-created zone
 * appears at the bottom of the list.
 */
export async function createZone(projectId: number, name: string) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await canEditRadios(session.user.id, projectId))) {
    return { error: 'Not authorized to manage zones on this project' }
  }
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Zone name is required' }
  if (trimmed.length > MAX_ZONE_NAME) return { error: 'Zone name too long' }

  // Compute the next display order from the current max.
  const last = await prisma.zone.findFirst({
    where: { projectId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  const nextOrder = (last?.order ?? -1) + 1

  await prisma.zone.create({
    data: {
      projectId,
      name: trimmed,
      order: nextOrder,
      channels: {
        create: Array.from({ length: ZONE_CHANNEL_COUNT }, (_, i) => ({
          channelIndex: i + 1,
          name: null,
        })),
      },
    },
  })

  revalidatePath('/radios')
  return { success: true }
}

/**
 * Update one zone — either its display name, or one or more of its 16
 * channel names. Pass `name` to rename the zone; pass `channels` as an
 * array of { channelIndex, name } to set channel names in bulk. Both
 * are optional so callers can patch a single field.
 */
export async function updateZone(
  zoneId: number,
  data: {
    name?: string
    channels?: Array<{ channelIndex: number; name: string | null }>
  },
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: { projectId: true },
  })
  if (!zone) return { error: 'Zone not found' }
  if (!(await canEditRadios(session.user.id, zone.projectId))) {
    return { error: 'Not authorized to edit this zone' }
  }

  if (data.name !== undefined) {
    const trimmed = data.name.trim()
    if (!trimmed) return { error: 'Zone name is required' }
    if (trimmed.length > MAX_ZONE_NAME) return { error: 'Zone name too long' }
    await prisma.zone.update({ where: { id: zoneId }, data: { name: trimmed } })
  }

  if (data.channels && data.channels.length > 0) {
    // Loop the updates — channelIndex is 1..16 and there's a unique
    // (zoneId, channelIndex) constraint, so we upsert per slot.
    for (const ch of data.channels) {
      if (
        !Number.isInteger(ch.channelIndex) ||
        ch.channelIndex < 1 ||
        ch.channelIndex > ZONE_CHANNEL_COUNT
      ) {
        return { error: 'Invalid channel index' }
      }
      const value = ch.name == null
        ? null
        : ch.name.trim() === ''
          ? null
          : ch.name.trim().slice(0, MAX_CHANNEL_NAME)
      await prisma.zoneChannel.upsert({
        where: {
          zoneId_channelIndex: { zoneId, channelIndex: ch.channelIndex },
        },
        create: { zoneId, channelIndex: ch.channelIndex, name: value },
        update: { name: value },
      })
    }
  }

  revalidatePath('/radios')
  return { success: true }
}

export async function deleteZone(zoneId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: { projectId: true },
  })
  if (!zone) return { error: 'Zone not found' }
  if (!(await canEditRadios(session.user.id, zone.projectId))) {
    return { error: 'Not authorized to delete this zone' }
  }

  await prisma.zone.delete({ where: { id: zoneId } })
  revalidatePath('/radios')
  return { success: true }
}

export async function deleteRadio(radioId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const radio = await prisma.radio.findUnique({
    where: { id: radioId },
    select: { projectId: true },
  })
  if (!radio) return { error: 'Radio not found' }
  if (!(await canEditRadios(session.user.id, radio.projectId))) {
    return { error: 'Not authorized to delete this radio' }
  }

  await prisma.radio.delete({ where: { id: radioId } })
  revalidatePath('/radios')
  return { success: true }
}
