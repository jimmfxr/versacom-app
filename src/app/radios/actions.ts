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

// ─── Scanner-flow helpers ──────────────────────────────────────────

/**
 * Result of a barcode lookup. One of three cases drives the scanner UI:
 *  - 'unknown' → no radio in this project has that barcode yet. The
 *    UI opens an assignment modal pre-filled with the next blank
 *    radio's row (which becomes the target on Save).
 *  - 'auto-return' → barcode matches a radio currently 'out'. The UI
 *    silently flips its status to 'returned' (no modal).
 *  - 'prompt' → barcode matches a radio with status na / returned /
 *    damaged / lost. The UI opens an edit modal pre-filled with that
 *    radio's current fields; Save flips status to 'out'.
 *
 * Permission-gated to admin/manager since scanning mutates assignment.
 */
export type RadioScanLookup =
  | { error: string }
  | { kind: 'unknown'; targetRadio: { id: number; name: string } | null }
  | {
      kind: 'auto-return' | 'prompt'
      radio: {
        id: number
        name: string
        firstName: string | null
        lastName: string | null
        department: string | null
        position: string | null
        barcode: string | null
        status: string
        assignedToProjectMemberId: number | null
        fistMic: boolean
        surveillance: boolean
        doubleMuff: boolean
        lightweight: boolean
        fistMicBarcode: string | null
        surveillanceBarcode: string | null
        doubleMuffBarcode: string | null
        lightweightBarcode: string | null
      }
    }

export async function lookupRadioByBarcode(
  projectId: number,
  barcode: string,
): Promise<RadioScanLookup> {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await canEditRadios(session.user.id, projectId))) {
    return { error: 'Not authorized to scan radios on this project' }
  }
  const trimmed = barcode.trim()
  if (!trimmed) return { error: 'Empty barcode' }
  if (trimmed.length > MAX_BARCODE) return { error: 'Barcode too long' }

  const match = await prisma.radio.findFirst({
    where: { projectId, barcode: trimmed },
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
      fistMicBarcode: true,
      surveillanceBarcode: true,
      doubleMuffBarcode: true,
      lightweightBarcode: true,
    },
  })

  if (match) {
    return {
      // Only an 'out' radio auto-returns on scan. Everything else
      // (na / returned / damaged / lost) prompts the operator via the
      // assignment modal so they confirm + can edit fields before
      // the radio flips back to 'out'.
      kind: match.status === 'out' ? 'auto-return' : 'prompt',
      radio: match,
    }
  }

  // Unknown barcode — find the next blank radio (no barcode yet) so the
  // scanner UI can offer it as the target slot. Natural sort by name so
  // "RAD 2" beats "RAD 10".
  const candidates = await prisma.radio.findMany({
    where: { projectId, barcode: null },
    select: { id: true, name: true },
  })
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  candidates.sort((a, b) => collator.compare(a.name, b.name))
  const targetRadio = candidates[0] ?? null

  return { kind: 'unknown', targetRadio }
}

/**
 * Save the assignment modal: attaches the (possibly new) barcode to
 * the chosen radio, writes the form fields, flips checkedOut to true.
 * Used for both the "unknown barcode" and the "scanned a returned
 * radio" flows — same destination state.
 */
export async function assignRadioFromScan(
  radioId: number,
  data: {
    barcode: string
    firstName?: string | null
    lastName?: string | null
    department?: string | null
    position?: string | null
    assignedToProjectMemberId?: number | null
    fistMic?: boolean
    surveillance?: boolean
    doubleMuff?: boolean
    lightweight?: boolean
    // Optional per-accessory barcodes. The scanner pops a sub-prompt
    // when an accessory chip is toggled ON so the operator can capture
    // the accessory's barcode separately from the radio body. Null /
    // omitted means the accessory is paired but un-barcoded (or off).
    fistMicBarcode?: string | null
    surveillanceBarcode?: string | null
    doubleMuffBarcode?: string | null
    lightweightBarcode?: string | null
    /** Internal recursion guard — number of times the action has
     *  hopped to a fresh target radio because the previous one was
     *  claimed by a concurrent scan. Don't pass from callers. */
    _reassignHops?: number
  },
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const radio = await prisma.radio.findUnique({
    where: { id: radioId },
    select: { projectId: true, barcode: true, name: true },
  })
  if (!radio) return { error: 'Radio not found' }
  if (!(await canEditRadios(session.user.id, radio.projectId))) {
    return { error: 'Not authorized to update this radio' }
  }

  const scannedBarcode = data.barcode.trim()
  if (!scannedBarcode) return { error: 'Barcode is required' }
  if (scannedBarcode.length > MAX_BARCODE) return { error: 'Barcode too long' }

  // Concurrent-scan recovery: the target radio row already has a
  // DIFFERENT barcode, meaning another operator's scan claimed this
  // blank slot between our lookup and our assign. Find the next
  // available blank row (status='na', barcode=null) and recurse so
  // every downstream check still runs against the correct radio.
  // Capped at 25 hops to prevent an infinite loop if someone manages
  // to fill the entire project's pool between iterations.
  const MAX_REASSIGN_HOPS = 25
  if (radio.barcode && radio.barcode !== scannedBarcode) {
    const hops = (data._reassignHops ?? 0) + 1
    if (hops > MAX_REASSIGN_HOPS) {
      return {
        error:
          'No blank radio rows left — bulk-create more in the Radios tab.',
      }
    }
    const nextBlank = await prisma.radio.findFirst({
      where: {
        projectId: radio.projectId,
        barcode: null,
        status: 'na',
      },
      orderBy: { name: 'asc' },
      select: { id: true },
    })
    if (!nextBlank) {
      return {
        error:
          'No blank radio rows left — bulk-create more in the Radios tab.',
      }
    }
    return assignRadioFromScan(nextBlank.id, { ...data, _reassignHops: hops })
  }

  // If this exact barcode is already on a different radio, treat the
  // scan as a no-op success — another operator just registered this
  // walkie. Returning success keeps the UI flowing instead of erroring.
  const dupe = await prisma.radio.findFirst({
    where: {
      projectId: radio.projectId,
      barcode: scannedBarcode,
      NOT: { id: radioId },
    },
    select: { id: true, name: true },
  })
  if (dupe) {
    revalidatePath('/radios')
    return { success: true, radioName: dupe.name }
  }

  await prisma.radio.update({
    where: { id: radioId },
    data: {
      barcode: scannedBarcode,
      firstName: clip(data.firstName, MAX_TEXT),
      lastName: clip(data.lastName, MAX_TEXT),
      department: clip(data.department, MAX_TEXT),
      position: clip(data.position, MAX_TEXT),
      assignedToProjectMemberId: data.assignedToProjectMemberId ?? null,
      fistMic: data.fistMic ?? false,
      surveillance: data.surveillance ?? false,
      doubleMuff: data.doubleMuff ?? false,
      lightweight: data.lightweight ?? false,
      // Only persist accessory barcodes when the matching flag is ON;
      // toggling a chip OFF should also clear any previously-captured
      // barcode so stale data doesn't linger on the row.
      fistMicBarcode: data.fistMic ? clip(data.fistMicBarcode, MAX_BARCODE) : null,
      surveillanceBarcode: data.surveillance ? clip(data.surveillanceBarcode, MAX_BARCODE) : null,
      doubleMuffBarcode: data.doubleMuff ? clip(data.doubleMuffBarcode, MAX_BARCODE) : null,
      lightweightBarcode: data.lightweight ? clip(data.lightweightBarcode, MAX_BARCODE) : null,
      status: 'out',
      checkedOutAt: new Date(),
    },
  })

  revalidatePath('/radios')
  return { success: true, radioName: radio.name }
}

/**
 * No-prompt return path: scanned barcode matches a radio whose status
 * is currently 'out' → flip status to 'returned'. Caller (the scanner
 * page) already confirmed the lookup kind === 'auto-return'.
 */
export async function returnRadioByBarcode(projectId: number, barcode: string) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await canEditRadios(session.user.id, projectId))) {
    return { error: 'Not authorized to return radios on this project' }
  }
  const trimmed = barcode.trim()
  if (!trimmed) return { error: 'Empty barcode' }

  const radio = await prisma.radio.findFirst({
    where: { projectId, barcode: trimmed },
    select: {
      id: true,
      status: true,
      name: true,
      firstName: true,
      lastName: true,
    },
  })
  if (!radio) return { error: 'No radio with that barcode in this project' }
  if (radio.status !== 'out') {
    // Not actually out — caller should have routed to the prompt
    // branch; treat as no-op success so duplicate scans don't error.
    return {
      success: true,
      alreadyReturned: true,
      name: radio.name,
      firstName: radio.firstName,
      lastName: radio.lastName,
    }
  }

  await prisma.radio.update({
    where: { id: radio.id },
    data: { status: 'returned' },
  })

  revalidatePath('/radios')
  return {
    success: true,
    name: radio.name,
    firstName: radio.firstName,
    lastName: radio.lastName,
  }
}

// ─── Manual status change (no-scan) ────────────────────────────────

const RADIO_STATUS_VALUES = new Set(['na', 'out', 'returned', 'damaged', 'lost'])

/**
 * Manual status flip from the dropdown on the radio card. Validates
 * the value against the canonical set so a bad input can't write
 * arbitrary strings to the column. checkedOutAt is stamped only when
 * the radio moves INTO 'out' (audit trail for the most recent check
 * out — other transitions leave the timestamp alone).
 */
export async function setRadioStatus(radioId: number, status: string) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!RADIO_STATUS_VALUES.has(status)) return { error: 'Invalid radio status' }

  const radio = await prisma.radio.findUnique({
    where: { id: radioId },
    select: { projectId: true, status: true },
  })
  if (!radio) return { error: 'Radio not found' }
  if (!(await canEditRadios(session.user.id, radio.projectId))) {
    return { error: 'Not authorized to update this radio' }
  }
  if (radio.status === status) return { success: true }

  await prisma.radio.update({
    where: { id: radioId },
    data: {
      status,
      ...(status === 'out' ? { checkedOutAt: new Date() } : {}),
    },
  })

  revalidatePath('/radios')
  return { success: true }
}

/* ─── Accessory inventory ───────────────────────────────────────────
 * Per-project "brought" counts for radio accessories (fist mic /
 * surveillance / double / LWHS). Stored in ProjectAccessoryInventory
 * with one row per (project, accessoryType). Mirrors the headset-
 * inventory editor pattern.
 *
 * The bulk-add card on /radios uses addAccessoryToInventory to
 * increment the brought count by the typed quantity.
 */

type AccessoryType = 'fistMic' | 'surveillance' | 'doubleMuff' | 'lightweight'

const ACCESSORY_TYPES: ReadonlySet<AccessoryType> = new Set([
  'fistMic',
  'surveillance',
  'doubleMuff',
  'lightweight',
])

/**
 * Batch SET the brought counts for all 4 accessory types in one
 * transaction. Mirrors how the headset / misc inventory editor on
 * Comms works — the editor shows all types at once and Save commits
 * everything atomically. Quantity 0 is valid (clears the inventory
 * row down to zero, doesn't delete it).
 */
export async function setAccessoryInventory(
  projectId: number,
  items: Array<{ accessoryType: string; brought: number }>,
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await canEditRadios(session.user.id, projectId))) {
    return { error: 'Not authorized to manage accessories on this project' }
  }
  // Validate every item BEFORE writing so a single bad row aborts the
  // whole save instead of half-applying.
  for (const item of items) {
    if (!ACCESSORY_TYPES.has(item.accessoryType as AccessoryType)) {
      return { error: `Unknown accessory type: ${item.accessoryType}` }
    }
    if (!Number.isInteger(item.brought) || item.brought < 0 || item.brought > 9999) {
      return { error: 'Brought count must be between 0 and 9999' }
    }
  }

  await prisma.$transaction(
    items.map((item) =>
      prisma.projectAccessoryInventory.upsert({
        where: {
          projectId_accessoryType: {
            projectId,
            accessoryType: item.accessoryType,
          },
        },
        update: { brought: item.brought },
        create: {
          projectId,
          accessoryType: item.accessoryType,
          brought: item.brought,
        },
      }),
    ),
  )

  revalidatePath('/radios')
  revalidatePath('/')
  return { success: true }
}
