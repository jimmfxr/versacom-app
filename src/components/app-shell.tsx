'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Navbar, type NavItem, type NavUser } from '@/components/navbar'
import { ToastContainer } from '@/components/toast'
import { ScrollToTop } from '@/components/scroll-to-top'

const userNavigation: ReadonlyArray<Pick<NavItem, 'name' | 'href'>> = [
  { name: 'Sign out', href: '#' },
]

function getNavigation(pathname: string, isAdmin: boolean, isUserOnly: boolean, showMyEquipment: boolean, lastProjectId: string | null, taskCount: number): NavItem[] {
  if (isUserOnly) {
    return [
      { name: 'My Equipment', href: '/my-equipment', current: pathname.startsWith('/my-equipment') },
    ]
  }
  const items: NavItem[] = []
  items.push({ name: 'Dashboard', href: '/', current: pathname === '/' })
  if (isAdmin) {
    items.push({ name: 'Tasks', href: '/admin', current: pathname.startsWith('/admin'), badge: taskCount })
  } else if (showMyEquipment) {
    // Crew get a different "Tasks" page focused on deployment work, with the
    // same kind of count badge admins get.
    items.push({ name: 'Tasks', href: '/tasks', current: pathname.startsWith('/tasks'), badge: taskCount })
  }
  const projectsHref = lastProjectId ? `/projects/${lastProjectId}` : '/projects'
  items.push({ name: 'Projects', href: projectsHref, current: pathname.startsWith('/projects') })
  if (showMyEquipment) {
    items.push({ name: 'My Equipment', href: '/my-equipment', current: pathname.startsWith('/my-equipment') })
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

  return (
    <div className="min-h-full bg-[#202020]">
      <Navbar
        navigation={getNavigation(pathname, isAdmin, isUserOnly, showMyEquipment, lastProjectId, taskCount)}
        user={navUser}
        userNavigation={userNavigation}
        onSignOut={handleSignOut}
      />
      {children}
      <ToastContainer />
      <ScrollToTop />
    </div>
  )
}
