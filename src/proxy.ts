import { NextRequest, NextResponse } from 'next/server'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes — always accessible
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname === '/manifest.json'
  ) {
    return NextResponse.next()
  }

  // Read session cookie
  const sessionCookie = request.cookies.get('session')
  if (!sessionCookie?.value) {
    // Not logged in — redirect to login
    return NextResponse.redirect(new URL('/login', request.url))
  }

  let session: {
    user: { id: number }
    memberships: { role: string }[]
  }

  try {
    session = JSON.parse(sessionCookie.value)
  } catch {
    // Invalid session — redirect to login
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Check if user only has "user" role across all memberships
  const isUserOnly = session.memberships.length > 0 && session.memberships.every((m) => m.role === 'user')

  if (isUserOnly) {
    // User role can ONLY access /my-equipment
    if (!pathname.startsWith('/my-equipment')) {
      return NextResponse.redirect(new URL('/my-equipment', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files and images
     */
    '/((?!_next/static|_next/image|favicon\\.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
