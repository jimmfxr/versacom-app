'use client'

import { useRouter, usePathname } from 'next/navigation'
import { Navbar, type NavItem, type NavUser } from '@/components/navbar'
import { ToastContainer } from '@/components/toast'
import { ScrollToTop } from '@/components/scroll-to-top'

const userNavigation: ReadonlyArray<Pick<NavItem, 'name' | 'href'>> = [
  { name: 'Sign out', href: '#' },
]

function getNavigation(pathname: string, isAdmin: boolean, isUserOnly: boolean): NavItem[] {
  if (isUserOnly) {
    return [
      { name: 'My Equipment', href: '/my-equipment', current: pathname.startsWith('/my-equipment') },
    ]
  }
  const items: NavItem[] = []
  if (isAdmin) {
    items.push({ name: 'Dashboard', href: '/', current: pathname === '/' })
    items.push({ name: 'Tasks', href: '/admin', current: pathname.startsWith('/admin') })
  }
  items.push({ name: 'Projects', href: '/projects', current: pathname.startsWith('/projects') })
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

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <div className="min-h-full bg-[#202020]">
      <Navbar
        navigation={getNavigation(pathname, isAdmin, isUserOnly)}
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
