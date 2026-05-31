import { NextRequest, NextResponse } from 'next/server'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes — always accessible
  if (
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/docs') ||
    // /zones/[id] is the public read-only radio zones page — kiosk
    // QR codes point here so crew can scan with their phone and see
    // the show's zone + channel layout without signing in.
    pathname.startsWith('/zones/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname === '/apple-touch-icon.png' ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js'
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
    // User role can access /my-equipment AND their own panel(s) via the
    // /projects/{id}/panel/{equipmentId} route. The Panel Studio page does
    // its own ownership check, so this just unlocks the URL.
    // /profile is also allowed so the navbar avatar / mobile user row
    // can reach the profile page (account info + sign-out).
    // /notifications is allowed because user-role accounts get five of
    // the `scope: 'all'` notification kinds (gear assigned, deploy
    // status, change-request reviewed, return phase, project archived)
    // — they need a surface to view them. The list query already scopes
    // by userId so they only see their own.
    const isPanelStudio = /^\/projects\/\d+\/panel\/\d+\/?$/.test(pathname)
    const isProfile = pathname === '/profile' || pathname.startsWith('/profile/')
    const isNotifications = pathname === '/notifications' || pathname.startsWith('/notifications/')
    if (
      !pathname.startsWith('/my-equipment') &&
      !isPanelStudio &&
      !isProfile &&
      !isNotifications
    ) {
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
