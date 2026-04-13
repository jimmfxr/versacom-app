import { Navbar, type NavItem, type NavUser } from '@/components/navbar'
import { PageHeader } from '@/components/page-header'
import { PlaceholderPanel } from '@/components/placeholder-panel'

const user: NavUser = {
  name: 'Tom Cook',
  email: 'tom@example.com',
  imageUrl:
    'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80',
}

const navigation: ReadonlyArray<NavItem> = [
  { name: 'Dashboard', href: '#', current: true },
  { name: 'Team', href: '#', current: false },
  { name: 'Projects', href: '#', current: false },
  { name: 'Calendar', href: '#', current: false },
]

const userNavigation: ReadonlyArray<Pick<NavItem, 'name' | 'href'>> = [
  { name: 'Your profile', href: '#' },
  { name: 'Settings', href: '#' },
  { name: 'Sign out', href: '#' },
]

export default function HomePage() {
  return (
    <div className="min-h-full">
      <Navbar navigation={navigation} user={user} userNavigation={userNavigation} />

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
