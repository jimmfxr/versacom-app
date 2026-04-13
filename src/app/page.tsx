'use client'

import { useRouter } from 'next/navigation'
import { Navbar, type NavItem, type NavUser } from '@/components/navbar'
import { PageHeader } from '@/components/page-header'
import { PlaceholderPanel } from '@/components/placeholder-panel'

const user: NavUser = {
  name: 'Jimmy Xiloj',
  email: '',
  imageUrl: '',
}

const navigation: ReadonlyArray<NavItem> = [
  { name: 'Dashboard', href: '/', current: true },
  { name: 'Tasks', href: '/admin', current: false },
  { name: 'Team', href: '#', current: false },
  { name: 'Projects', href: '#', current: false },
]

const userNavigation: ReadonlyArray<Pick<NavItem, 'name' | 'href'>> = [
  { name: 'Your profile', href: '#' },
  { name: 'Settings', href: '#' },
  { name: 'Sign out', href: '#' },
]

export default function HomePage() {
  const router = useRouter()

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <div className="min-h-full bg-[#202020]">
      <Navbar
        navigation={navigation}
        user={user}
        userNavigation={userNavigation}
        onSignOut={handleSignOut}
      />

      <div className="py-10">
        <PageHeader title="Dashboard" />
        <main>
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <PlaceholderPanel />
          </div>
        </main>
      </div>
    </div>
  )
}
