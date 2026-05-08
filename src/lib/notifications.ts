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

async function safeSend(userIds: number[], payload: PushPayload): Promise<void> {
  if (userIds.length === 0) return
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
  })
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
  })
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
  })
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
  })
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
  })
}
