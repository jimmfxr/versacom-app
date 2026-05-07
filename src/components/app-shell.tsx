'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Navbar, type NavItem, type NavUser } from '@/components/navbar'
import { ToastContainer } from '@/components/toast'
import { ScrollToTop } from '@/components/scroll-to-top'

const userNavigation: ReadonlyArray<Pick<NavItem, 'name' | 'href'>> = [
  { name: 'Sign out', href: '#' },
]

function getNavigation(
  pathname: string,
  isAdmin: boolean,
  isUserOnly: boolean,
  showMyEquipment: boolean,
  lastProjectId: string | null,
  taskCount: number,
  inMyEquipmentBrowse: boolean,
): NavItem[] {
  if (isUserOnly) {
    return [
      { name: 'My Equipment', href: '/my-equipment', current: pathname.startsWith('/my-equipment') },
    ]
  }
  // /my-equipment for admin/manager redirects to /projects/X/panel/Y?from=my-equipment.
  // From the URL alone the route looks like a project page, but the user is
  // really inside the My Equipment surface. Use the from=my-equipment search
  // param to flip the active highlight away from Projects and onto My Equipment.
  const onMyEquipment = pathname.startsWith('/my-equipment') || inMyEquipmentBrowse
  const onProjects = pathname.startsWith('/projects') && !inMyEquipmentBrowse

  const items: NavItem[] = []
  items.push({ name: 'Dashboard', href: '/', current: pathname === '/' })
  if (isAdmin) {
    items.push({ name: 'Tasks', href: '/admin', current: pathname.startsWith('/admin'), badge: taskCount })
  } else if (showMyEquipment) {
    items.push({ name: 'Tasks', href: '/tasks', current: pathname.startsWith('/tasks'), badge: taskCount })
  }
  const projectsHref = lastProjectId ? `/projects/${lastProjectId}` : '/projects'
  items.push({ name: 'Projects', href: projectsHref, current: onProjects })
  if (!isUserOnly) {
    items.push({ name: 'My Equipment', href: '/my-equipment', current: onMyEquipment })
  }
  return items
}

export function AppShell({ children, userName, isAdmin = false, isUserOnly = false, showMyEquipment = false }: { children: React.ReactNode; userName?: string; isAdmin?: boolean; isUserOnly?: boolean; showMyEquipment?: boolean }) {
  const navUser: NavUser = {
    name: userName || 'User',
    email: '',
    imageUrl: '',
  }
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const inMyEquipmentBrowse = searchParams.get('from') === 'my-equipment'

  const [lastProjectId, setLastProjectId] = useState<string | null>(null)
  useEffect(() => {
    const match = document.cookie.match(/lastProject=(\d+)/)
    setLastProjectId(match ? match[1] : null)
  }, [pathname])

  // Poll the admin task count so the Tasks badge stays fresh on every page,
  // not just /admin. Only runs for admins — non-admins skip the network.
  //
  // The count is mirrored to sessionStorage so the badge keeps its last
  // known value across page navigations instead of flashing back to 0
  // while the first fetch of the new page is in flight. We can't read
  // sessionStorage during initial render (server has no DOM, would cause
  // a hydration mismatch), so we hydrate inside a useEffect that fires
  // synchronously after mount — typically same frame as the first paint.
  const [taskCount, setTaskCount] = useState(0)

  // Hydrate from sessionStorage immediately after mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const key = isAdmin ? 'task-count-cache' : 'crew-task-count-cache'
      const cached = sessionStorage.getItem(key)
      if (cached) {
        const n = Number(cached)
        if (!Number.isNaN(n)) setTaskCount(n)
      }
    } catch {
      // sessionStorage may be unavailable; ignore.
    }
  }, [isAdmin])

  useEffect(() => {
    // Admins poll their /admin task list; crew (non-admin with crew role)
    // poll the deployment task list at /tasks. Same UI badge, different
    // source endpoint.
    const isCrew = !isAdmin && showMyEquipment
    if (!isAdmin && !isCrew) return
    const endpoint = isAdmin ? '/api/admin/task-count' : '/api/tasks/count'
    const cacheKey = isAdmin ? 'task-count-cache' : 'crew-task-count-cache'
    let cancelled = false
    async function fetchCount() {
      try {
        const res = await fetch(endpoint, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { count: number }
        if (cancelled) return
        setTaskCount(data.count)
        try {
          sessionStorage.setItem(cacheKey, String(data.count))
        } catch {
          // sessionStorage may be unavailable; ignore.
        }
      } catch {
        // Silent — badge just won't update this cycle.
      }
    }
    fetchCount()
    const timer = setInterval(fetchCount, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isAdmin, showMyEquipment])

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  // Global haptic feedback for taps on actionable elements. Fires
  // navigator.vibrate(10) on `pointerdown` for any element matching
  // button / role=button / [data-haptic] / anchors-as-buttons. iOS
  // and iPadOS don't expose the Vibration API (the call no-ops there
  // — Apple still has no web-haptics primitive), but Android Chrome
  // and most desktop browsers honor it. Listening on `pointerdown`
  // (not `click`) gives the buzz the moment the finger touches down,
  // which is what users expect on native apps. A guard skips form
  // controls (input/textarea/select) so typing doesn't buzz on every
  // key, and disabled elements are ignored too.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof navigator.vibrate !== 'function') return
    function onPointerDown(e: PointerEvent) {
      // Only fire for primary touch / mouse buttons.
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
      const target = e.target as Element | null
      if (!target) return
      // Walk up to the nearest button-ish ancestor.
      const el = target.closest('button, [role="button"], a[href], [data-haptic="true"]') as HTMLElement | null
      if (!el) return
      // Skip disabled buttons.
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return
      try {
        navigator.vibrate(10)
      } catch {
        // ignore — vibration may be blocked by user-agent policy.
      }
    }
    document.addEventListener('pointerdown', onPointerDown, { passive: true })
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  return (
    // Viewport-locked flex column on all screen sizes so pages can
    // implement kiosk-style inner scroll regions (header / tabs / chips
    // fixed, only the list scrolls).
    <div
      className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#202020]"
      style={{
        // iOS PWA in standalone mode: 100dvh extends beneath the
        // home indicator. Reserve that strip with the safe-area
        // inset so kiosk-style scroll regions (Dashboard cards,
        // Tasks list, etc.) don't render content underneath it.
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <Navbar
        navigation={getNavigation(pathname, isAdmin, isUserOnly, showMyEquipment, lastProjectId, taskCount, inMyEquipmentBrowse)}
        user={navUser}
        userNavigation={userNavigation}
        onSignOut={handleSignOut}
      />
      {/* Children wrapper is just a flex column. NO scroll handling
          here — pages own their own scroll. Sticky / kiosk pages use
          min-h-0 + flex-1 + overflow-y-auto on inner regions;
          non-sticky pages (PageLayout's non-sticky branch) wrap the
          content in their own overflow-y-auto. Avoids nested scroll
          containers, which iOS Safari handles poorly. */}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <ToastContainer />
      <ScrollToTop />
    </div>
  )
}
