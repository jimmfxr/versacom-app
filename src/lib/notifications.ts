// Domain-level web-push helpers.
//
// Each function maps a business event to a `sendPushToUsers` call —
// one place to look up recipients + write the copy for each kind of
// notification. Callers (server actions / API routes) just call the
// matching helper without thinking about VAPID, recipient filtering,
// or payload shape.
//
// All helpers are fire-and-forget: they swallow errors and never
// reject. Push delivery is opportunistic — the app's polling and
// in-app state are still the source of truth.

import { prisma } from '@/lib/db'
import { sendPushToUsers, type PushPayload } from '@/lib/web-push'

async function safeSend(
  userIds: number[],
  payload: PushPayload,
  /** Project the notification is scoped to. Stored on each row so the
   *  /notifications page can filter by project via the dropdown. Pass
   *  null for genuinely global notifications (account-level pings). */
  projectId: number | null = null,
): Promise<void> {
  if (userIds.length === 0) return
  // Persist a history row per recipient BEFORE attempting push delivery.
  // This way the in-app /notifications page reflects every message we
  // intended to send — even if push fails (expired subscription,
  // device offline, user blocked). Persistence + delivery are
  // intentionally decoupled so neither breaks the other.
  try {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        projectId,
        title: payload.title,
        body: payload.body ?? null,
        url: payload.url ?? null,
        tag: payload.tag ?? null,
      })),
    })
  } catch (err) {
    console.warn('[notifications] persist failed', err)
  }
  try {
    await sendPushToUsers(userIds, payload)
  } catch (err) {
    console.warn('[notifications] send failed', err)
  }
}

async function adminUserIds(projectId: number, exclude?: number): Promise<number[]> {
  const rows = await prisma.projectMember.findMany({
    where: { projectId, role: 'admin' },
    select: { userId: true },
  })
  const set = new Set(rows.map((r: { userId: number }) => r.userId))
  if (exclude !== undefined) set.delete(exclude)
  return Array.from(set)
}

async function projectName(projectId: number): Promise<string> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  })
  return p?.name ?? 'a show'
}

async function userFullName(userId: number): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  })
  return u ? `${u.firstName} ${u.lastName}` : 'Someone'
}

// ─── Member joined a project ────────────────────────────────────────
//
// Triggered when joinProject / createPersonalPin / createKioskMember
// add a ProjectMember row. Notifies every admin on the project.

export async function notifyMemberJoined(args: {
  projectId: number
  memberName: string
  role: 'admin' | 'manager' | 'crew' | 'user'
}): Promise<void> {
  const recipients = await adminUserIds(args.projectId)
  const name = await projectName(args.projectId)
  await safeSend(recipients, {
    title: `${args.memberName} joined as ${args.role}`,
    body: name,
    url: `/projects`,
    tag: `join-${args.projectId}-${Date.now()}`,
  }, args.projectId)
}

// ─── Account locked out ─────────────────────────────────────────────
//
// Triggered from the login route when a user hits MAX_ATTEMPTS wrong
// PINs. Notifies all admins on every project the locked user is a
// member of, so whichever admin sees it first can intervene.

export async function notifyUserLocked(args: {
  lockedUserId: number
}): Promise<void> {
  const memberships = await prisma.projectMember.findMany({
    where: { userId: args.lockedUserId },
    select: { projectId: true },
  })
  if (memberships.length === 0) return
  const projectIds = Array.from(new Set(memberships.map((m: { projectId: number }) => m.projectId)))
  const adminRows = await prisma.projectMember.findMany({
    where: { projectId: { in: projectIds }, role: 'admin' },
    select: { userId: true },
  })
  const recipients = Array.from(new Set(adminRows.map((r: { userId: number }) => r.userId)))
  if (recipients.length === 0) return
  const name = await userFullName(args.lockedUserId)
  await safeSend(recipients, {
    title: `${name} is locked out`,
    body: `Open Tasks to unlock or wait 15 minutes`,
    url: `/admin`,
    tag: `lockout-${args.lockedUserId}`,
  })
}

// ─── Equipment deploy status changed ────────────────────────────────
//
// Triggered when an admin/crew toggles deployStatus on an Equipment
// row. Notifies project admins (so they can audit) plus the assignee
// (so the crew member sees their gear move through the workflow).
// Excludes the actor — they don't need to buzz themselves.

const DEPLOY_STATUS_VERB: Record<string, string> = {
  deployed: 'deployed',
  done: 'marked done',
  returned: 'returned',
  'not-needed': 'marked not needed',
  damaged: 'flagged as damaged',
  na: 'reset to not deployed',
}

export async function notifyDeployStatusChanged(args: {
  equipmentId: number
  newStatus: string
  actorUserId: number
}): Promise<void> {
  const eq = await prisma.equipment.findUnique({
    where: { id: args.equipmentId },
    select: {
      name: true,
      projectId: true,
      assignedTo: { select: { userId: true } },
    },
  })
  if (!eq) return
  const recipients = new Set<number>()
  for (const id of await adminUserIds(eq.projectId, args.actorUserId)) recipients.add(id)
  if (eq.assignedTo?.userId && eq.assignedTo.userId !== args.actorUserId) {
    recipients.add(eq.assignedTo.userId)
  }
  if (recipients.size === 0) return
  const verb = DEPLOY_STATUS_VERB[args.newStatus] ?? `set to ${args.newStatus}`
  const name = await projectName(eq.projectId)
  const actorName = await userFullName(args.actorUserId)
  await safeSend(Array.from(recipients), {
    title: `${eq.name ?? 'Equipment'} ${verb}`,
    body: `${actorName} · ${name}`,
    url: `/projects/${eq.projectId}`,
    tag: `eq-${args.equipmentId}-${args.newStatus}`,
  }, eq.projectId)
}

// ─── Return phase activated ─────────────────────────────────────────
//
// Triggered when an admin flips a project's `returnPhaseActive` to
// true. Notifies every member except the actor so crew know to start
// checking gear back in.

export async function notifyReturnPhaseActivated(args: {
  projectId: number
  actorUserId: number
}): Promise<void> {
  const members = await prisma.projectMember.findMany({
    where: { projectId: args.projectId },
    select: { userId: true },
  })
  const recipients = Array.from(new Set(members.map((m: { userId: number }) => m.userId)))
    .filter((id) => id !== args.actorUserId)
  if (recipients.length === 0) return
  const name = await projectName(args.projectId)
  await safeSend(recipients, {
    title: `Return phase active`,
    body: `${name} — start checking gear back in`,
    url: `/tasks`,
    tag: `return-${args.projectId}`,
  }, args.projectId)
}

// ─── Project archived ───────────────────────────────────────────────
//
// Triggered when an admin archives a project. Heads-up to every
// member that the show closed.

export async function notifyProjectArchived(args: {
  projectId: number
  actorUserId: number
}): Promise<void> {
  const members = await prisma.projectMember.findMany({
    where: { projectId: args.projectId },
    select: { userId: true },
  })
  const recipients = Array.from(new Set(members.map((m: { userId: number }) => m.userId)))
    .filter((id) => id !== args.actorUserId)
  if (recipients.length === 0) return
  const name = await projectName(args.projectId)
  await safeSend(recipients, {
    title: `${name} archived`,
    body: `The show is closed`,
    url: `/projects`,
    tag: `archive-${args.projectId}`,
  }, args.projectId)
}

// ─── CR endorsed by manager ─────────────────────────────────────────
//
// When the manager-endorse flow is wired in. Notifies admins so they
// know there's an endorsed CR ready to apply.

export async function notifyManagerEndorsed(args: {
  projectId: number
  endorserUserId: number
  changeRequestId: number
}): Promise<void> {
  const recipients = await adminUserIds(args.projectId, args.endorserUserId)
  if (recipients.length === 0) return
  const name = await projectName(args.projectId)
  const endorser = await userFullName(args.endorserUserId)
  await safeSend(recipients, {
    title: `${endorser} endorsed a change`,
    body: name,
    url: `/admin`,
    tag: `endorse-${args.changeRequestId}`,
  }, args.projectId)
}

// ─── Equipment edited (Mockup C — most-impactful headline) ──────────
//
// Fires from updateEquipment when crew/admin saves a change to any
// non-deployStatus field on a piece of gear. Picks the most
// operationally significant changed field for the headline so the
// admin sees what mattered at a glance. Body line stays short:
// "{actor} · {project}".
//
// deployStatus is intentionally NOT handled here — it has its own
// dedicated `notifyDeployStatusChanged` helper.

type EquipmentDiff = {
  // Each field provides before + after only when it changed. Caller
  // is responsible for diffing — this helper just renders.
  name?: { before: string | null; after: string | null }
  hardwareType?: { before: string | null; after: string | null }
  position?: { before: string | null; after: string | null }
  location?: { before: string | null; after: string | null }
  headsetType?: { before: string | null; after: string | null }
  ipAddress?: { before: string | null; after: string | null }
  patch?: { before: string | null; after: string | null }
  assignedToId?: {
    before: number | null
    after: number | null
    afterName: string | null
  }
  gooseneck?: { before: boolean; after: boolean }
  footswitches?: { before: number; after: number }
  speakers?: { before: number; after: number }
}

const EDIT_PRIORITY: Array<keyof EquipmentDiff> = [
  'assignedToId',
  'location',
  'hardwareType',
  'headsetType',
  'ipAddress',
  'name',
  'gooseneck',
  'footswitches',
  'speakers',
  'position',
  'patch',
]

function renderEquipmentHeadline(
  field: keyof EquipmentDiff,
  diff: EquipmentDiff,
  eqName: string,
): string {
  switch (field) {
    case 'assignedToId': {
      const d = diff.assignedToId!
      if (d.after == null) return `${eqName} unassigned`
      return `${eqName} assigned to ${d.afterName ?? 'a member'}`
    }
    case 'location': {
      const d = diff.location!
      if (!d.after) return `${eqName} location cleared`
      return `${eqName} moved to ${d.after}`
    }
    case 'hardwareType': {
      const d = diff.hardwareType!
      if (!d.after) return `${eqName} hardware cleared`
      return `${eqName} changed to ${d.after}`
    }
    case 'headsetType': {
      const d = diff.headsetType!
      if (!d.after) return `${eqName} headset cleared`
      return `${eqName} headset set to ${d.after}`
    }
    case 'ipAddress': {
      const d = diff.ipAddress!
      if (!d.after) return `${eqName} IP cleared`
      return `${eqName} IP set to ${d.after}`
    }
    case 'name': {
      const d = diff.name!
      return `${d.before ?? eqName} renamed to ${d.after ?? '(blank)'}`
    }
    case 'gooseneck':
      return `${eqName} gooseneck ${diff.gooseneck!.after ? 'added' : 'removed'}`
    case 'footswitches':
      return `${eqName} footswitches: ${diff.footswitches!.before} → ${diff.footswitches!.after}`
    case 'speakers':
      return `${eqName} speakers: ${diff.speakers!.before} → ${diff.speakers!.after}`
    case 'position': {
      const d = diff.position!
      if (!d.after) return `${eqName} position cleared`
      return `${eqName} position set to ${d.after}`
    }
    case 'patch': {
      const d = diff.patch!
      if (!d.after) return `${eqName} patch cleared`
      return `${eqName} patch set to ${d.after}`
    }
  }
}

export async function notifyEquipmentEdited(args: {
  equipmentId: number
  actorUserId: number
  diff: EquipmentDiff
}): Promise<void> {
  // Find the highest-priority field that actually changed.
  const topField = EDIT_PRIORITY.find((f) => args.diff[f] !== undefined)
  if (!topField) return // nothing changed (deployStatus-only saves land here)

  const eq = await prisma.equipment.findUnique({
    where: { id: args.equipmentId },
    select: { name: true, projectId: true },
  })
  if (!eq) return

  const recipients = await adminUserIds(eq.projectId, args.actorUserId)
  if (recipients.length === 0) return

  const eqName = eq.name ?? 'Equipment'
  const headline = renderEquipmentHeadline(topField, args.diff, eqName)
  const actor = await userFullName(args.actorUserId)
  const project = await projectName(eq.projectId)

  await safeSend(recipients, {
    title: headline,
    body: `${actor} · ${project}`,
    url: `/projects/${eq.projectId}`,
    tag: `eq-edit-${args.equipmentId}-${Date.now()}`,
  }, eq.projectId)
}

// ─── Admin opened a change request for review ──────────────────────
//
// Heads-up to the submitter that someone is looking at their request
// right now. Fires when an admin lands on the Panel Studio page with
// `?review={memberId}`. One push per (CR, admin) — dedupe is via the
// Web Push `tag` field so reloads / re-opens don't stack notifications
// on the user's device (the OS replaces the previous one).

export async function notifyReviewStarted(args: {
  // The submitter's CRs being reviewed in this session, grouped at
  // the call site. Bundling multiple CRs into a single push prevents
  // spamming the user when one admin opens a review covering several
  // of their pending requests at once.
  submitterUserId: number
  reviewerUserId: number
  changeRequestIds: number[]
  equipmentId: number
  projectId: number
}): Promise<void> {
  if (args.submitterUserId === args.reviewerUserId) return
  if (args.changeRequestIds.length === 0) return

  const [reviewer, project, equipment] = await Promise.all([
    prisma.user.findUnique({
      where: { id: args.reviewerUserId },
      select: { firstName: true, lastName: true },
    }),
    prisma.project.findUnique({
      where: { id: args.projectId },
      select: { name: true },
    }),
    prisma.equipment.findUnique({
      where: { id: args.equipmentId },
      select: { name: true },
    }),
  ])
  const reviewerName = reviewer
    ? `${reviewer.firstName} ${reviewer.lastName}`
    : 'Admin'
  const projectNameStr = project?.name ?? 'a show'
  const eqName = equipment?.name ?? 'your panel'
  const count = args.changeRequestIds.length
  const title =
    count === 1
      ? `${reviewerName} is reviewing your request`
      : `${reviewerName} is reviewing ${count} of your requests`

  await safeSend([args.submitterUserId], {
    title,
    body: `${eqName} · ${projectNameStr}`,
    url: `/projects/${args.projectId}/panel/${args.equipmentId}`,
    // Tag scoped to (submitter, reviewer) so reloads / reopens by
    // the same admin replace the previous notification on the
    // device instead of stacking. Different admins reviewing the
    // same submitter's requests still each get their own buzz
    // because the reviewer ID is part of the tag.
    tag: `review-${args.submitterUserId}-${args.reviewerUserId}`,
  }, args.projectId)
}

// ─── Equipment newly assigned (to the assignee) ─────────────────────
//
// Personal "you've got new gear" buzz when someone gets reassigned
// a piece of equipment. Distinct from notifyEquipmentEdited which
// goes to admins; this one only fires for the new assignee so they
// know they're now responsible for the gear.

export async function notifyEquipmentAssigned(args: {
  equipmentId: number
  newAssigneeUserId: number
  actorUserId: number
}): Promise<void> {
  if (args.newAssigneeUserId === args.actorUserId) return // self-assign — no buzz
  const eq = await prisma.equipment.findUnique({
    where: { id: args.equipmentId },
    select: { name: true, projectId: true },
  })
  if (!eq) return
  const eqName = eq.name ?? 'a panel'
  const actor = await userFullName(args.actorUserId)
  const project = await projectName(eq.projectId)
  await safeSend([args.newAssigneeUserId], {
    title: `You're now on ${eqName}`,
    body: `${actor} · ${project}`,
    url: `/projects/${eq.projectId}/panel/${args.equipmentId}`,
    tag: `eq-assign-${args.equipmentId}-${args.newAssigneeUserId}`,
  }, eq.projectId)
}
