import { cookies } from 'next/headers'

type SessionData = {
  user: {
    id: number
    firstName: string
    lastName: string
  }
  memberships: {
    id: number
    role: string
    position: string | null
    project: { id: number; name: string }
  }[]
}

export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')
  if (!sessionCookie?.value) return null
  try {
    return JSON.parse(sessionCookie.value) as SessionData
  } catch {
    return null
  }
}
