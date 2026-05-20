'use client'

import { useState, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Navbar, type NavItem, type NavUser } from '@/components/navbar'
import { ToastContainer } from '@/components/toast'
import { ScrollToTop } from '@/components/scroll-to-top'

function getNavigation(
  pathname: string,
  isAdmin: boolean,
  isUserOnly: boolean,
  showMyEquipment: boolean,
  lastProjectId: string | null,
  lastProjectName: string | null,
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
  // Single context-aware Projects tab. When the user is INSIDE a specific
  // /projects/<id> route, the tab labels itself with that show's name so
  // the nav reflects context. Anywhere else (including the bare /projects
  // list) it just says "All projects". Tapping it always navigates back
  // to the list — the project name is informational, not a self-link.
  const onProjectsRoute = pathname.startsWith('/projects') && !inMyEquipmentBrowse
  const insideProject = onProjectsRoute && pathname !== '/projects'

  const items: NavItem[] = []
  items.push({ name: 'Dashboard', href: '/', current: pathname === '/' })
  if (isAdmin) {
    items.push({ name: 'Tasks', href: '/admin', current: pathname.startsWith('/admin'), badge: taskCount })
  } else if (showMyEquipment) {
    items.push({ name: 'Tasks', href: '/tasks', current: pathname.startsWith('/tasks'), badge: taskCount })
  }
  items.push({
    name: insideProject ? (lastProjectName || 'All projects') : 'All projects',
    href: '/projects',
    current: onProjectsRoute,
  })
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
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const inMyEquipmentBrowse = searchParams.get('from') === 'my-equipment'

  // The current-project nav tab labels itself with the project's name and
  // links to /projects/<id>. We hydrate both from cookies written by the
  // ProjectSwitcher (selectedProject*) and the project page itself
  // (lastProject*). selectedProject* wins when both are set so the nav
  // matches whatever the user last picked via the dropdown.
  const [lastProjectId, setLastProjectId] = useState<string | null>(null)
  const [lastProjectName, setLastProjectName] = useState<string | null>(null)
  useEffect(() => {
    function readName(key: string): string | null {
      const m = document.cookie.match(new RegExp(`${key}=([^;]+)`))
      if (!m) return null
      try {
        return decodeURIComponent(m[1])
      } catch {
        return m[1]
      }
    }
    const selected = document.cookie.match(/selectedProject=(\d+)/)
    if (selected) {
      setLastProjectId(selected[1])
      setLastProjectName(readName('selectedProjectName'))
      return
    }
    const last = document.cookie.match(/lastProject=(\d+)/)
    setLastProjectId(last ? last[1] : null)
    setLastProjectName(readName('lastProjectName'))
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

  // ─── Unread notification count for the navbar bell badge ───
  // Mirrors the task-count pattern above: useState + sessionStorage
  // hydrate on mount, then poll /api/notifications/count every 5s so
  // the bell badge stays fresh across pages without a hard reload.
  const [notificationUnread, setNotificationUnread] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const cached = sessionStorage.getItem('notification-unread-cache')
      if (cached) {
        const n = Number(cached)
        if (!Number.isNaN(n)) setNotificationUnread(n)
      }
    } catch {
      // sessionStorage may be unavailable; ignore.
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    async function fetchUnread() {
      try {
        const res = await fetch('/api/notifications/count', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { unread: number }
        if (cancelled) return
        setNotificationUnread(data.unread)
        try {
          sessionStorage.setItem('notification-unread-cache', String(data.unread))
        } catch {
          // sessionStorage may be unavailable; ignore.
        }
      } catch {
        // Silent — badge just won't update this cycle.
      }
    }
    fetchUnread()
    const timer = setInterval(fetchUnread, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    // Hard navigation rather than router.push — soft routing keeps
    // the root layout (with this AppShell + navbar) in the cached
    // tree, so /login would render with the navbar still visible.
    // window.location forces a fresh server render of the layout
    // with the now-cleared session cookie, which bypasses AppShell
    // entirely and shows /login chrome-free.
    window.location.href = '/login'
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
        // Block horizontal rubber-band on iOS Safari. Without this,
        // a horizontal swipe inside an overflow-x scroller (the
        // SwipeCarousel) could bleed past its bounds and shove the
        // whole page sideways.
        overscrollBehaviorX: 'contain',
      }}
    >
      {/* Kiosk routes (/projects/<id>/kiosk) are full-screen
          chassis viewers — no nav, no chrome. The navbar is
          rendered for every other authed route via the root
          layout's AppShell, but kiosk gets the bare children. */}
      {!pathname.includes('/kiosk') && (
        <Navbar
          navigation={getNavigation(pathname, isAdmin, isUserOnly, showMyEquipment, lastProjectId, lastProjectName, taskCount, inMyEquipmentBrowse)}
          user={navUser}
          onSignOut={handleSignOut}
          notificationUnread={notificationUnread}
        />
      )}
      {/* Children wrapper is just a flex column with horizontal
          overflow locked. Vertical scroll is owned by individual
          pages (sticky/kiosk via internal flex-1 + overflow-y-auto
          regions; non-sticky via PageLayout's wrapper). overflow-x
          locked here as well as on AppShell outer because iOS
          Safari's rubber-band can let a horizontal swipe in a
          nested scroller (e.g. SwipeCarousel) propagate up and
          rubber-band the whole page sideways. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden">{children}</div>
      <ToastContainer />
      <ScrollToTop />
    </div>
  )
}
