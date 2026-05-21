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

/** Existing user — they already have a PIN and history. Send them to the
 *  plain login page with name pre-filled so they sign in with their PIN. */
function buildSignInUrl(firstName: string, lastName: string) {
  const params = new URLSearchParams({ firstName, lastName })
  return `${PRODUCTION_URL}/login?${params.toString()}`
}

/**
 * Kiosk action: create a brand-new user + project membership in one shot,
 * then return the deep-linked join URL so the kiosk can show a scan-ready QR.
 */
export async function createKioskMember(
  projectId: number,
  firstName: string,
  lastName: string,
  position?: string,
  department?: string,
): Promise<KioskResult> {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (!(await canRunKiosk(session.user.id, projectId))) {
    return { error: 'Not authorized to run kiosk on this project' }
  }

  const fn = firstName.trim()
  const ln = lastName.trim()
  const pos = position?.trim() || null
  const dept = department?.trim() || null
  if (!fn || !ln) return { error: 'First and last name are required' }
  if (fn.length > 50 || ln.length > 50) return { error: 'Name too long' }
  if (pos && pos.length > 50) return { error: 'Position too long' }
  if (dept && dept.length > 50) return { error: 'Department too long' }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { pin: true },
  })
  if (!project?.pin) {
    return { error: 'Project needs a 4-digit PIN before kiosk can run' }
  }

  // Look for an existing real user (PIN set) with that name first. Same
  // three-branch logic as updatePendingMember:
  //   - Real user already a member of this project → block (avoid dupe membership)
  //   - Real user exists but not yet on this project → add them, return sign-in URL
  //   - No real user with that name → create a fresh placeholder, return join URL
  const existingRealUser = await prisma.user.findFirst({
    where: {
      firstName: { equals: fn, mode: 'insensitive' },
      lastName: { equals: ln, mode: 'insensitive' },
      pin: { not: '' },
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { createdAt: 'desc' },
  })

  if (existingRealUser) {
    const existingMembership = await prisma.projectMember.findFirst({
      where: { projectId, userId: existingRealUser.id },
      select: { id: true },
    })
    if (existingMembership) {
      return { error: `${existingRealUser.firstName} ${existingRealUser.lastName} is already on this project — they can sign in with their PIN.` }
    }
    // Mirror the typed department onto the User row so it follows the
    // person across shows.
    if (dept) {
      await prisma.user.update({
        where: { id: existingRealUser.id },
        data: { department: dept },
      })
    }
    await prisma.projectMember.create({
      data: { userId: existingRealUser.id, projectId, role: 'crew', position: pos, department: dept },
    })
    revalidatePath(`/projects/${projectId}`)
    revalidatePath(`/projects/${projectId}/kiosk`)
    return {
      success: true,
      firstName: existingRealUser.firstName,
      lastName: existingRealUser.lastName,
      joinUrl: buildSignInUrl(existingRealUser.firstName, existingRealUser.lastName),
    }
  }

  // Also block if there's a placeholder (PIN='') with this exact name on this
  // project — manager should pick them from the Pending list rather than
  // creating yet another placeholder.
  const existingPlaceholder = await prisma.projectMember.findFirst({
    where: {
      projectId,
      user: {
        firstName: { equals: fn, mode: 'insensitive' },
        lastName: { equals: ln, mode: 'insensitive' },
      },
    },
    select: { id: true },
  })
  if (existingPlaceholder) {
    return { error: `${fn} ${ln} is already on this project — edit them in the Pending list below` }
  }

  // Fresh placeholder: create user (no PIN) + project membership as crew.
  // Department goes on the User row so it persists across shows.
  const user = await prisma.user.create({
    data: { firstName: fn, lastName: ln, pin: '', department: dept },
  })
  await prisma.projectMember.create({
    data: { userId: user.id, projectId, role: 'crew', position: pos, department: dept },
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
 * Kiosk action: update a pending member's name + position.
 *
 * Three outcomes depending on what the manager typed:
 *
 *   1. The new name doesn't match any existing user → just rename the
 *      placeholder User row (current behavior). QR points at the join
 *      flow so they set a new PIN.
 *
 *   2. The new name matches an EXISTING user (PIN already set) and that
 *      user is ALREADY a member of this project → delete the placeholder
 *      member row, leave the real user's existing membership untouched
 *      (don't overwrite their position). QR points at /login with the
 *      name pre-filled so they sign in with their existing PIN.
 *
 *   3. The new name matches an existing user but they're NOT yet a
 *      member of this project → delete the placeholder, also delete the
 *      placeholder User row so we don't leave an orphan, create a new
 *      membership tying the real user to this project with the typed
 *      position. QR points at /login with name pre-filled.
 */
export async function updatePendingMember(
  memberId: number,
  data: { firstName: string; lastName: string; position: string | null; department?: string | null },
): Promise<KioskResult> {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const member = await prisma.projectMember.findUnique({
    where: { id: memberId },
    select: {
      projectId: true,
      userId: true,
      project: { select: { pin: true } },
    },
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
  const department = data.department?.trim() || null
  if (department && department.length > 50) return { error: 'Department too long' }

  // Look for an EXISTING user with that name and a real PIN. If duplicates
  // exist (shouldn't, but defensive), pick the most recently created one.
  const existingRealUser = await prisma.user.findFirst({
    where: {
      id: { not: member.userId },
      firstName: { equals: fn, mode: 'insensitive' },
      lastName: { equals: ln, mode: 'insensitive' },
      pin: { not: '' },
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { createdAt: 'desc' },
  })

  if (!existingRealUser) {
    // ── Branch 1: fresh placeholder rename ──
    // Mirror department onto the User row alongside name updates.
    await prisma.user.update({
      where: { id: member.userId },
      data: {
        firstName: fn,
        lastName: ln,
        ...(department !== null ? { department } : {}),
      },
    })
    await prisma.projectMember.update({
      where: { id: memberId },
      data: { position, department },
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

  // Existing user with PIN found. Check whether they're already on this
  // project under their REAL identity.
  const existingMembership = await prisma.projectMember.findFirst({
    where: { projectId: member.projectId, userId: existingRealUser.id },
    select: { id: true },
  })

  // Cleanup steps shared by branches 2 and 3: delete the placeholder member
  // row (and the placeholder user row, since it had no PIN and no other
  // memberships rely on it).
  await prisma.$transaction(async (tx) => {
    await tx.projectMember.delete({ where: { id: memberId } })
    // Only delete the placeholder user if it has no other memberships.
    const otherMemberships = await tx.projectMember.count({
      where: { userId: member.userId },
    })
    if (otherMemberships === 0) {
      await tx.user.delete({ where: { id: member.userId } })
    }

    if (!existingMembership) {
      // Branch 3: create a new membership for the real user.
      // Mirror department onto their User row.
      if (department) {
        await tx.user.update({
          where: { id: existingRealUser.id },
          data: { department },
        })
      }
      await tx.projectMember.create({
        data: {
          userId: existingRealUser.id,
          projectId: member.projectId,
          role: 'crew',
          position,
          department,
        },
      })
    }
    // Branch 2: existing membership stays untouched on purpose so we don't
    // overwrite the position they already have on this project.
  })

  revalidatePath(`/projects/${member.projectId}`)
  revalidatePath(`/projects/${member.projectId}/kiosk`)
  return {
    success: true,
    firstName: existingRealUser.firstName,
    lastName: existingRealUser.lastName,
    // Real user with a PIN — sign-in URL, not join URL.
    joinUrl: buildSignInUrl(existingRealUser.firstName, existingRealUser.lastName),
  }
}
