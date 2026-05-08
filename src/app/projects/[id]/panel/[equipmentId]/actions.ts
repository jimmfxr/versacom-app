'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { sendPushToUsers } from '@/lib/web-push'

/* ─── Hardware key counts ─── */
const HARDWARE_KEY_COUNTS: Record<string, number> = {
  'RSP-1232': 32,
  'RSP-1216': 16,
  'DSP-1216': 16,
  'KP-5032': 32,
  'KP32': 32,
  'RSP-2318': 18,
  'DSP-2312': 12,
  'DKP-3016': 16,
  'KP-3016': 16,
  'DSPK4': 4,
  'Helixnet': 4,
  'DBP4': 4,
  'DBP5': 4,
  'ST-374': 4,
  'ST370': 2,
  'C3': 2,
  'BP325': 2,
  'Bolero 1.9': 6,
  'Bolero 2.4': 6,
  'Freespeak': 4,
  'Pliant': 4,
}

/* ─── Expansion key counts per device ─── */
const EXPANSION_KEY_COUNTS: Record<string, number> = {
  'RSP-1232': 16,
  'RSP-1216': 16,
  'KP-5032': 32,
  'KP32': 32,
  'RSP-2318': 24,
}

/* ─── Devices that support shift pages (panels only) ─── */
const SHIFT_PAGE_DEVICES = new Set([
  'RSP-1232', 'RSP-1216', 'DSP-1216', 'KP-5032', 'KP32', 'RSP-2318', 'DSP-2312',
  'DKP-3016', 'KP-3016', 'DSPK4',
])

async function getSession() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')
  if (!sessionCookie?.value) return null
  try {
    return JSON.parse(sessionCookie.value) as { user: { id: number } }
  } catch {
    return null
  }
}

/* ─── Save keys (admin — immediate save) ─── */
export async function saveKeys(
  projectMemberId: number,
  // PanelKeys are equipment-scoped now — multi-device members have one
  // row per device per slot, so callers must specify which device the
  // edits belong to.
  equipmentId: number,
  keys: Array<{
    keyIndex: number
    page: string
    expansion: number
    pickListItemId: number | null
    triggerMode: string
    talkMode: string
  }>
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    for (const key of keys) {
      await prisma.panelKey.upsert({
        where: {
          equipmentId_keyIndex_page_expansion: {
            equipmentId,
            keyIndex: key.keyIndex,
            page: key.page,
            expansion: key.expansion,
          },
        },
        update: {
          pickListItemId: key.pickListItemId,
          triggerMode: key.triggerMode,
          talkMode: key.talkMode,
        },
        create: {
          projectMemberId,
          equipmentId,
          keyIndex: key.keyIndex,
          page: key.page,
          expansion: key.expansion,
          pickListItemId: key.pickListItemId,
          triggerMode: key.triggerMode,
          talkMode: key.talkMode,
        },
      })
    }

    revalidatePath(`/projects`)
    revalidatePath(`/my-equipment`)
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('saveKeys error:', msg, e)
    return { error: `Failed to save keys: ${msg}` }
  }
}

/* ─── Save draft keys (crew/manager — save as drafts) ─── */
export async function saveDraftKeys(
  projectMemberId: number,
  // PanelKey rows are equipment-scoped; the caller passes the device the
  // drafts belong to so multi-device members keep their key state apart.
  equipmentId: number,
  userId: number,
  keys: Array<{
    keyIndex: number
    page: string
    expansion: number
    pickListItemId: number | null
    triggerMode: string
    talkMode: string
  }>
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    for (const key of keys) {
      // Ensure PanelKey row exists
      const panelKey = await prisma.panelKey.upsert({
        where: {
          equipmentId_keyIndex_page_expansion: {
            equipmentId,
            keyIndex: key.keyIndex,
            page: key.page,
            expansion: key.expansion,
          },
        },
        update: {},
        create: {
          projectMemberId,
          equipmentId,
          keyIndex: key.keyIndex,
          page: key.page,
          expansion: key.expansion,
          pickListItemId: null,
          triggerMode: 'latch',
          talkMode: 'tl',
        },
      })

      // Create or update draft
      const existingDraft = await prisma.keyDraft.findFirst({
        where: {
          panelKeyId: panelKey.id,
          editedById: userId,
          status: 'draft',
        },
      })

      if (existingDraft) {
        await prisma.keyDraft.update({
          where: { id: existingDraft.id },
          data: {
            pickListItemId: key.pickListItemId,
            triggerMode: key.triggerMode,
            talkMode: key.talkMode,
          },
        })
      } else {
        await prisma.keyDraft.create({
          data: {
            panelKeyId: panelKey.id,
            editedById: userId,
            pickListItemId: key.pickListItemId,
            triggerMode: key.triggerMode,
            talkMode: key.talkMode,
          },
        })
      }
    }

    revalidatePath(`/projects`)
    revalidatePath(`/my-equipment`)
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('saveDraftKeys error:', msg, e)
    return { error: `Failed to save draft keys: ${msg}` }
  }
}

/* ─── Submit changes (crew/manager — submit drafts as a change request) ─── */
export async function submitChanges(
  projectMemberId: number,
  // ChangeRequests are equipment-scoped — submitting on HWBP 1 produces a
  // separate review card from a submission on PNL 3, even when the same
  // member owns both devices.
  equipmentId: number,
  projectId: number,
  userId: number
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    // Find draft entries for this user scoped to THIS equipment so
    // multi-device members don't accidentally roll a sibling device's
    // drafts into this submission.
    const drafts = await prisma.keyDraft.findMany({
      where: {
        editedById: userId,
        status: 'draft',
        panelKey: { projectMemberId, equipmentId },
      },
      include: { panelKey: true },
    })

    if (drafts.length === 0) {
      return { error: 'No pending changes to submit' }
    }

    // Create the change request
    const changeRequest = await prisma.changeRequest.create({
      data: {
        projectId,
        submittedById: userId,
        targetMemberId: projectMemberId,
        equipmentId,
        status: 'submitted',
        items: {
          create: drafts.map((draft) => ({
            panelKeyId: draft.panelKeyId,
            fieldChanged: 'pickListItemId',
            previousValue: draft.panelKey.pickListItemId?.toString() ?? null,
            newValue: draft.pickListItemId?.toString() ?? null,
          })),
        },
      },
    })

    // Mark drafts as submitted
    await prisma.keyDraft.updateMany({
      where: {
        id: { in: drafts.map((d) => d.id) },
      },
      data: { status: 'submitted' },
    })

    // ─── Web push fanout: notify every admin on this project ───
    // Fire-and-forget so a slow push service doesn't stall the
    // request. The submitter doesn't need to know whether the push
    // delivered — they have the green-bordered keys as confirmation.
    void notifyAdminsOfNewChangeRequest({
      projectId,
      submittedById: userId,
      targetMemberId: projectMemberId,
      equipmentId,
      keyCount: drafts.length,
      changeRequestId: changeRequest.id,
    }).catch((err) => console.warn('[push] submit fanout failed', err))

    revalidatePath(`/projects`)
    revalidatePath(`/admin`)
    revalidatePath(`/my-equipment`)
    return { success: true, changeRequestId: changeRequest.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('submitChanges error:', msg, e)
    return { error: `Failed to submit changes: ${msg}` }
  }
}

/* ─── Add expansion panel ─── */
export async function addExpansion(
  projectMemberId: number,
  // Expansions live on a specific device. Scoping by equipmentId keeps
  // PNL 3's expansion separate from HWBP 1's when one member owns both.
  equipmentId: number,
  hardwareType: string
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  // Guard: only expandable devices
  const expansionKeyCount = EXPANSION_KEY_COUNTS[hardwareType]
  if (!expansionKeyCount) {
    return { error: 'This device does not support expansions' }
  }

  try {
    // Find the current highest expansion number on THIS device.
    const maxExpansion = await prisma.panelKey.findFirst({
      where: { equipmentId },
      orderBy: { expansion: 'desc' },
      select: { expansion: true },
    })

    const nextExpansion = (maxExpansion?.expansion ?? 0) + 1
    if (nextExpansion > 6) {
      return { error: 'Maximum 6 expansions allowed' }
    }

    const keyCount = expansionKeyCount
    const hasShift = SHIFT_PAGE_DEVICES.has(hardwareType)
    const pages = hasShift ? ['main', 'shift'] : ['main']

    // Create empty keys for the new expansion
    const keysToCreate: Array<{
      projectMemberId: number
      equipmentId: number
      keyIndex: number
      page: string
      expansion: number
      triggerMode: string
      talkMode: string
    }> = []

    for (const page of pages) {
      for (let i = 0; i < keyCount; i++) {
        keysToCreate.push({
          projectMemberId,
          equipmentId,
          keyIndex: i,
          page,
          expansion: nextExpansion,
          triggerMode: 'latch',
          talkMode: 'tl',
        })
      }
    }

    await prisma.panelKey.createMany({ data: keysToCreate })

    revalidatePath(`/projects`)
    return { success: true, expansion: nextExpansion }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('addExpansion error:', msg, e)
    return { error: `Failed to add expansion: ${msg}` }
  }
}

/* ─── Remove expansion panel ─── */
export async function removeExpansion(
  projectMemberId: number,
  // Scope deletion to the specific device — without this, removing an
  // expansion on PNL 3 would also wipe HWBP 1's keys at the same expansion.
  equipmentId: number,
  expansion: number
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (expansion < 1) {
    return { error: 'Cannot remove the main panel' }
  }

  try {
    // Delete all drafts associated with these keys first
    const keysToDelete = await prisma.panelKey.findMany({
      where: { equipmentId, expansion },
      select: { id: true },
    })

    const keyIds = keysToDelete.map((k) => k.id)

    if (keyIds.length > 0) {
      await prisma.keyDraft.deleteMany({
        where: { panelKeyId: { in: keyIds } },
      })
      await prisma.changeRequestItem.deleteMany({
        where: { panelKeyId: { in: keyIds } },
      })
    }

    await prisma.panelKey.deleteMany({
      where: { equipmentId, expansion },
    })

    void projectMemberId // accepted for API symmetry; deletion scopes by device
    revalidatePath(`/projects`)
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('removeExpansion error:', msg, e)
    return { error: `Failed to remove expansion: ${msg}` }
  }
}

/* ─── Resolve change requests (admin — approve selected items, deny rejected ones) ─── */
export async function resolveChangeRequests(
  changeRequestIds: number[],
  approvedItemIds: number[],
  deniedItemIds: number[]
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    const approvedSet = new Set(approvedItemIds)
    // Collected outside the loop so we can fan out one push per CR
    // AFTER the DB writes commit. Web push is best-effort — we don't
    // want a slow push service to delay the resolve response.
    const resolveOutcomes: Array<{
      submittedById: number
      changeRequestId: number
      equipmentId: number | null
      projectId: number
      kind: 'applied' | 'rejected' | 'mixed'
      approvedKeys: number
      deniedKeys: number
    }> = []

    for (const crId of changeRequestIds) {
      const cr = await prisma.changeRequest.findUnique({
        where: { id: crId },
        include: { items: true },
      })

      if (!cr) continue
      if (cr.status !== 'submitted' && cr.status !== 'mgr_endorsed') continue

      // Apply only approved items to the actual PanelKeys
      for (const item of cr.items) {
        if (approvedSet.has(item.id) && item.fieldChanged === 'pickListItemId') {
          const newPickId = item.newValue ? parseInt(item.newValue) : null
          await prisma.panelKey.update({
            where: { id: item.panelKeyId },
            data: { pickListItemId: newPickId },
          })
        }
      }

      // Determine final status: if all items denied → rejected, otherwise → applied
      const crItemIds = cr.items.map((i) => i.id)
      const approvedCount = crItemIds.filter((id) => approvedSet.has(id)).length
      const deniedCount = crItemIds.length - approvedCount
      const allDenied = approvedCount === 0

      await prisma.changeRequest.update({
        where: { id: crId },
        data: {
          status: allDenied ? 'rejected' : 'applied',
          resolvedAt: new Date(),
        },
      })

      // Clean up associated drafts
      const panelKeyIds = cr.items.map((i) => i.panelKeyId)
      await prisma.keyDraft.deleteMany({
        where: {
          panelKeyId: { in: panelKeyIds },
          status: 'submitted',
        },
      })

      resolveOutcomes.push({
        submittedById: cr.submittedById,
        changeRequestId: cr.id,
        equipmentId: cr.equipmentId ?? null,
        projectId: cr.projectId,
        kind: allDenied ? 'rejected' : approvedCount > 0 && deniedCount > 0 ? 'mixed' : 'applied',
        approvedKeys: approvedCount,
        deniedKeys: deniedCount,
      })
    }

    // Push notification to each submitter (one per CR resolved). Fire
    // and forget — the in-app polling already updates the panel; push
    // is just so the user knows even when the tab isn't focused.
    void Promise.all(
      resolveOutcomes.map((o) => notifySubmitterOfResolution(o)),
    ).catch((err) => console.warn('[push] resolve fanout failed', err))

    revalidatePath(`/projects`)
    revalidatePath(`/admin`)
    revalidatePath(`/my-equipment`)
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('resolveChangeRequests error:', msg, e)
    return { error: `Failed to resolve: ${msg}` }
  }
}

// ─── Push notification helpers ───────────────────────────────────────
//
// Internal — called fire-and-forget from submitChanges /
// resolveChangeRequests so push delivery doesn't block the user
// response. All errors swallowed; the polling-based fingerprint
// sync is the source of truth, push is purely a "wake the device".

type SubmitNotifyArgs = {
  projectId: number
  submittedById: number
  targetMemberId: number
  equipmentId: number
  keyCount: number
  changeRequestId: number
}

async function notifyAdminsOfNewChangeRequest(args: SubmitNotifyArgs) {
  // Recipients: every admin on this project. We exclude the submitter
  // themselves in case an admin submitted on someone else's panel —
  // they'll see it via the in-app badge and don't need a buzz too.
  const adminMembers = await prisma.projectMember.findMany({
    where: { projectId: args.projectId, role: 'admin' },
    select: { userId: true },
  })
  const recipients = adminMembers
    .map((m) => m.userId)
    .filter((id) => id !== args.submittedById)
  if (recipients.length === 0) return

  // Resolve names for a meaningful body — fall back gracefully.
  const [submitter, target, equipment, project] = await Promise.all([
    prisma.user.findUnique({
      where: { id: args.submittedById },
      select: { firstName: true, lastName: true },
    }),
    prisma.projectMember.findUnique({
      where: { id: args.targetMemberId },
      select: { user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.equipment.findUnique({
      where: { id: args.equipmentId },
      select: { name: true },
    }),
    prisma.project.findUnique({
      where: { id: args.projectId },
      select: { name: true },
    }),
  ])

  const submitterName = submitter
    ? `${submitter.firstName} ${submitter.lastName}`
    : 'Someone'
  const targetName = target
    ? `${target.user.firstName} ${target.user.lastName}`
    : 'a crew member'
  const eqName = equipment?.name ?? 'their panel'
  const projectName = project?.name ?? 'a show'
  const keyWord = args.keyCount === 1 ? 'key' : 'keys'

  await sendPushToUsers(recipients, {
    title: `${args.keyCount} ${keyWord} pending review`,
    body: `${submitterName} edited ${eqName} for ${targetName} (${projectName})`,
    url: `/admin`,
    tag: `cr-${args.changeRequestId}`,
  })
}

type ResolveNotifyArgs = {
  submittedById: number
  changeRequestId: number
  equipmentId: number | null
  projectId: number
  kind: 'applied' | 'rejected' | 'mixed'
  approvedKeys: number
  deniedKeys: number
}

async function notifySubmitterOfResolution(args: ResolveNotifyArgs) {
  // Resolve equipment + project names for context.
  const [equipment, project] = await Promise.all([
    args.equipmentId
      ? prisma.equipment.findUnique({
          where: { id: args.equipmentId },
          select: { name: true },
        })
      : Promise.resolve(null),
    prisma.project.findUnique({
      where: { id: args.projectId },
      select: { name: true },
    }),
  ])
  const eqName = equipment?.name ?? 'your panel'
  const projectName = project?.name ?? 'the show'

  let title: string
  let body: string
  if (args.kind === 'applied') {
    const word = args.approvedKeys === 1 ? 'key' : 'keys'
    title = `${args.approvedKeys} ${word} approved`
    body = `${eqName} on ${projectName} is live`
  } else if (args.kind === 'rejected') {
    const word = args.deniedKeys === 1 ? 'key' : 'keys'
    title = `${args.deniedKeys} ${word} denied`
    body = `${eqName} on ${projectName}`
  } else {
    title = `${args.approvedKeys} approved · ${args.deniedKeys} denied`
    body = `${eqName} on ${projectName}`
  }

  // Deep-link to the panel for the submitter so tapping the
  // notification opens the same view they last edited.
  const url = args.equipmentId
    ? `/projects/${args.projectId}/panel/${args.equipmentId}`
    : `/`

  await sendPushToUsers([args.submittedById], {
    title,
    body,
    url,
    tag: `cr-${args.changeRequestId}`,
  })
}
