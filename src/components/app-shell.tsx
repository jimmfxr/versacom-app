'use client'

import { useRouter, usePathname } from 'next/navigation'
import { Navbar, type NavItem, type NavUser } from '@/components/navbar'

const navUser: NavUser = {
  name: 'Jimmy Xiloj',
  email: '',
  imageUrl: '',
}

const userNavigation: ReadonlyArray<Pick<NavItem, 'name' | 'href'>> = [
  { name: 'Your profile', href: '#' },
  { name: 'Settings', href: '#' },
  { name: 'Sign out', href: '#' },
]

function getNavigation(pathname: string): NavItem[] {
  // Extract project ID from path like /projects/123/...
  const projectMatch = pathname.match(/^\/projects\/(\d+)/)
  const projectId = projectMatch ? projectMatch[1] : null

  return [
    { name: 'Dashboard', href: '/', current: pathname === '/' },
    { name: 'Tasks', href: '/admin', current: pathname.startsWith('/admin') },
    {
      name: 'Distribution',
      href: projectId ? `/projects/${projectId}/distribution` : '/distribution',
      current: pathname.includes('/distribution'),
    },
    {
      name: 'Projects',
      href: '/projects',
      current: pathname.startsWith('/projects') && !pathname.includes('/distribution'),
    },
  ]
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <div className="min-h-full bg-[#202020]">
      <Navbar
        navigation={getNavigation(pathname)}
        user={navUser}
        userNavigation={userNavigation}
        onSignOut={handleSignOut}
      />
      {children}
    </div>
  )
}
