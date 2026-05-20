import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { ProfileForm } from './profile-form'

export const dynamic = 'force-dynamic'

/**
 * Profile page — every role lands here when they tap the navbar avatar.
 * Server-loads the current user record so the form starts with the
 * fresh DB values (the session cookie may be stale if the user just
 * edited their name on another device).
 */
export default async function ProfilePage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      firstName: true,
      lastName: true,
      position: true,
      email: true,
      phone: true,
      avatarUrl: true,
    },
  })
  if (!user) redirect('/login')

  return (
    <ProfileForm
      initial={{
        firstName: user.firstName,
        lastName: user.lastName,
        position: user.position,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
      }}
    />
  )
}
