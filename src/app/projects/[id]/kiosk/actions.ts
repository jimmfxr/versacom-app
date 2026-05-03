'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'

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

/** Confirms caller is admin or manager on the project. */
async function canRunKiosk(userId: number, projectId: number) {
  const membership = await prisma.projectMember.findFirst({
    where: { projectId, userId },
    select: { role: true },
  })
  if (membership?.role === 'admin' || membership?.role === 'manager') return true
  // Global admins (admin role on any project) can also run any kiosk.
  const globalAdmin = await prisma.projectMember.findFirst({
    where: { userId, role: 'admin' },
    select: { id: true },
  })
  return !!globalAdmin
}

type KioskResult =
  | { error: string }
  | { success: true; firstName: string; lastName: string; joinUrl: string }

const PRODUCTION_URL = 'https://versacom-app.vercel.app'

function buildJoinUrl(projectPin: string, firstName: string, lastName: string) {
  const params = new URLSearchParams({
    pin: projectPin,
    firstName,
    lastName,
  })
  return `${PRODUCTION_URL}/login/join?${params.toString()}`
}

/**
 * Kiosk action: create a brand-new user + project membership in one shot,
 * then return the deep-linked join URL so the kiosk can show a scan-ready QR.
 */
export async function createKioskMember(
  projectId: number,
  firstName: string,
  lastName: string,
): Promise<KioskResult> {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await canRunKiosk(session.user.id, projectId))) {
    return { error: 'Not authorized to run kiosk on this project' }
  }

  const fn = firstName.trim()
  const ln = lastName.trim()
  if (!fn || !ln) return { error: 'First and last name are required' }
  if (fn.length > 50 || ln.length > 50) return { error: 'Name too long' }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { pin: true },
  })
  if (!project?.pin) {
    return { error: 'Project needs a 4-digit PIN before kiosk can run' }
  }

  // If a user with this exact name already exists in this project, route the
  // manager to edit them instead of silently double-adding.
  const existingMember = await prisma.projectMember.findFirst({
    where: {
      projectId,
      user: {
        firstName: { equals: fn, mode: 'insensitive' },
        lastName: { equals: ln, mode: 'insensitive' },
      },
    },
    select: { id: true },
  })
  if (existingMember) {
    return { error: `${fn} ${ln} is already on this project — edit them in the Pending list below` }
  }

  // Create user (no PIN — they set one on first login) + add them to the
  // project as a crew member.
  const user = await prisma.user.create({
    data: {
      firstName: fn,
      lastName: ln,
      pin: '',
    },
  })
  await prisma.projectMember.create({
    data: {
      userId: user.id,
      projectId,
      role: 'crew',
    },
  })

  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/kiosk`)
  return {
    success: true,
    firstName: fn,
    lastName: ln,
    joinUrl: buildJoinUrl(project.pin, fn, ln),
  }
}

/**
 * Kiosk action: update a pending member's name + position, then return the
 * deep-linked join URL so the kiosk can show a fresh QR for them.
 */
export async function updatePendingMember(
  memberId: number,
  data: { firstName: string; lastName: string; position: string | null },
): Promise<KioskResult> {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const member = await prisma.projectMember.findUnique({
    where: { id: memberId },
    select: { projectId: true, userId: true, project: { select: { pin: true } } },
  })
  if (!member) return { error: 'Member not found' }

  if (!(await canRunKiosk(session.user.id, member.projectId))) {
    return { error: 'Not authorized to run kiosk on this project' }
  }
  if (!member.project.pin) {
    return { error: 'Project needs a 4-digit PIN before kiosk can run' }
  }

  const fn = data.firstName.trim()
  const ln = data.lastName.trim()
  if (!fn || !ln) return { error: 'First and last name are required' }
  if (fn.length > 50 || ln.length > 50) return { error: 'Name too long' }
  const position = data.position?.trim() || null
  if (position && position.length > 50) return { error: 'Position too long' }

  await prisma.user.update({
    where: { id: member.userId },
    data: { firstName: fn, lastName: ln },
  })
  await prisma.projectMember.update({
    where: { id: memberId },
    data: { position },
  })

  revalidatePath(`/projects/${member.projectId}`)
  revalidatePath(`/projects/${member.projectId}/kiosk`)
  return {
    success: true,
    firstName: fn,
    lastName: ln,
    joinUrl: buildJoinUrl(member.project.pin, fn, ln),
  }
}
