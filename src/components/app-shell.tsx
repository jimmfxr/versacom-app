'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Navbar, type NavItem, type NavUser } from '@/components/navbar'
import { ToastContainer } from '@/components/toast'
import { ScrollToTop } from '@/components/scroll-to-top'

const userNavigation: ReadonlyArray<Pick<NavItem, 'name' | 'href'>> = [
  { name: 'Sign out', href: '#' },
]

function getNavigation(pathname: string, isAdmin: boolean, isUserOnly: boolean, lastProjectId: string | null): NavItem[] {
  if (isUserOnly) {
    return [
      { name: 'My Equipment', href: '/my-equipment', current: pathname.startsWith('/my-equipment') },
    ]
  }
  const items: NavItem[] = []
  items.push({ name: 'Dashboard', href: '/', current: pathname === '/' })
  if (isAdmin) {
    items.push({ name: 'Tasks', href: '/admin', current: pathname.startsWith('/admin') })
  }
  const projectsHref = lastProjectId ? `/projects/${lastProjectId}` : '/projects'
  items.push({ name: 'Projects', href: projectsHref, current: pathname.startsWith('/projects') })
  return items
}

export function AppShell({ children, userName, isAdmin = false, isUserOnly = false }: { children: React.ReactNode; userName?: string; isAdmin?: boolean; isUserOnly?: boolean }) {
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

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <div className="min-h-full bg-[#202020]">
      <Navbar
        navigation={getNavigation(pathname, isAdmin, isUserOnly, lastProjectId)}
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
