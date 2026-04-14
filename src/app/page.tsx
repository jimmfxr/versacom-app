import { getSession } from '@/lib/session'
import { HomeContent } from './home-content'

export default async function HomePage() {
  const session = await getSession()
  const userName = session ? `${session.user.firstName} ${session.user.lastName}` : undefined
  const isAdmin = session?.memberships.some((m) => m.role === 'admin') ?? false
  const isUserOnly = session ? session.memberships.every((m) => m.role === 'user') : false

  return <HomeContent userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} />
}
