'use server'

import bcrypt from 'bcryptjs'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

const MAX_NAME_LEN = 60
const MAX_POSITION_LEN = 60
const MAX_DEPARTMENT_LEN = 60
const MAX_EMAIL_LEN = 120
const MAX_PHONE_LEN = 40
// Data URLs come in ~30–60 KB after our client-side resize. Reject
// anything wildly larger so a misbehaving client can't OOM the DB row.
const MAX_AVATAR_LEN = 300_000
// Simple email shape check — full validation belongs at the auth layer
// where it actually matters; this is just a soft "looks like an email"
// guard so users don't type their phone number into the email field.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function capitalize(s: string): string {
  s = s.trim()
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase()
}

/**
 * Update the current user's profile. Single round-trip for all four
 * fields — leaving any field undefined leaves it untouched, leaving
 * avatarUrl explicitly null clears the current photo. Also refreshes
 * the session cookie so the navbar reflects the new name immediately
 * without forcing the user to log out and back in.
 */
export async function updateProfile(input: {
  firstName?: string
  lastName?: string
  position?: string | null
  department?: string | null
  email?: string | null
  phone?: string | null
  avatarUrl?: string | null
}) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const data: {
    firstName?: string
    lastName?: string
    position?: string | null
    department?: string | null
    email?: string | null
    phone?: string | null
    avatarUrl?: string | null
  } = {}

  if (input.firstName !== undefined) {
    const v = capitalize(input.firstName)
    if (v.length === 0) return { error: 'First name is required' }
    if (v.length > MAX_NAME_LEN) return { error: 'First name too long' }
    data.firstName = v
  }
  if (input.lastName !== undefined) {
    const v = capitalize(input.lastName)
    if (v.length === 0) return { error: 'Last name is required' }
    if (v.length > MAX_NAME_LEN) return { error: 'Last name too long' }
    data.lastName = v
  }
  if (input.position !== undefined) {
    if (input.position === null || input.position.trim() === '') {
      data.position = null
    } else {
      const v = input.position.trim()
      if (v.length > MAX_POSITION_LEN) return { error: 'Position too long' }
      data.position = v
    }
  }
  if (input.department !== undefined) {
    if (input.department === null || input.department.trim() === '') {
      data.department = null
    } else {
      const v = input.department.trim()
      if (v.length > MAX_DEPARTMENT_LEN) return { error: 'Department too long' }
      data.department = v
    }
  }
  if (input.email !== undefined) {
    if (input.email === null || input.email.trim() === '') {
      data.email = null
    } else {
      const v = input.email.trim()
      if (v.length > MAX_EMAIL_LEN) return { error: 'Email too long' }
      if (!EMAIL_REGEX.test(v)) return { error: 'Invalid email format' }
      data.email = v
    }
  }
  if (input.phone !== undefined) {
    if (input.phone === null || input.phone.trim() === '') {
      data.phone = null
    } else {
      const v = input.phone.trim()
      if (v.length > MAX_PHONE_LEN) return { error: 'Phone too long' }
      data.phone = v
    }
  }
  if (input.avatarUrl !== undefined) {
    if (input.avatarUrl === null) {
      data.avatarUrl = null
    } else {
      if (!input.avatarUrl.startsWith('data:image/')) {
        return { error: 'Invalid image format' }
      }
      if (input.avatarUrl.length > MAX_AVATAR_LEN) {
        return { error: 'Image too large — try a smaller photo' }
      }
      data.avatarUrl = input.avatarUrl
    }
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { firstName: true, lastName: true },
  })

  // Refresh the session cookie so the navbar shows the new name on the
  // very next request. We only touch user.firstName / user.lastName —
  // memberships are stable so we keep the existing array.
  const newSession = {
    ...session,
    user: {
      ...session.user,
      firstName: updated.firstName,
      lastName: updated.lastName,
    },
  }
  const cookieStore = await cookies()
  cookieStore.set('session', JSON.stringify(newSession), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  })

  revalidatePath('/profile')
  revalidatePath('/')
  return { success: true }
}

/**
 * Rotate the current user's PIN. Verifies the supplied `currentPin`
 * against the bcrypt hash on the user row, then writes a fresh hash
 * for `newPin`. PINs are 4 digits — matching the login flow's
 * validation so the rules stay consistent.
 */
export async function changePin(input: { currentPin: string; newPin: string }) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (!/^\d{4}$/.test(input.newPin)) {
    return { error: 'New PIN must be 4 digits' }
  }
  if (input.currentPin === input.newPin) {
    return { error: 'New PIN must differ from current PIN' }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { pin: true },
  })
  if (!user) return { error: 'User not found' }

  const ok = await bcrypt.compare(input.currentPin, user.pin)
  if (!ok) return { error: 'Current PIN is incorrect' }

  const newHash = await bcrypt.hash(input.newPin, 10)
  await prisma.user.update({
    where: { id: session.user.id },
    data: { pin: newHash, failedAttempts: 0, lockedUntil: null },
  })

  return { success: true }
}
