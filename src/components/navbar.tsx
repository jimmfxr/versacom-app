'use client'

import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from '@headlessui/react'
import { Bars3Icon, BellIcon, XMarkIcon } from '@heroicons/react/24/outline'

export type NavItem = {
  readonly name: string
  readonly href: string
  readonly current?: boolean
}

export type NavUser = {
  readonly name: string
  readonly email: string
  readonly imageUrl: string
}

export type NavbarProps = {
  readonly navigation: ReadonlyArray<NavItem>
  readonly user: NavUser
  readonly userNavigation: ReadonlyArray<Pick<NavItem, 'name' | 'href'>>
  readonly logoSrc?: string
  readonly logoAlt?: string
  readonly onSignOut?: () => void
}

function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

const DEFAULT_LOGO_SRC = '/clair_logo_white.png'

export function Navbar({
  navigation,
  user,
  userNavigation,
  logoSrc = DEFAULT_LOGO_SRC,
  logoAlt = 'Clair',
  onSignOut,
}: NavbarProps) {
  return (
    <Disclosure as="nav" className="sticky top-0 z-40 bg-[#202020]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between">
          <div className="flex">
            <div className="flex shrink-0 items-center">
              <img alt={logoAlt} src={logoSrc} className="h-8 w-auto" />
            </div>
            <div className="hidden sm:-my-px sm:ml-6 sm:flex sm:space-x-8">
              {navigation.map((item) => (
                <a
                  key={item.name}
                  href={item.href}
                  aria-current={item.current ? 'page' : undefined}
                  className={classNames(
                    item.current
                      ? 'border-[#0178a3] text-white'
                      : 'border-transparent text-gray-400 hover:border-white/20 hover:text-gray-200',
                    'inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium',
                  )}
                >
                  {item.name}
                </a>
              ))}
            </div>
          </div>
          <div className="hidden sm:ml-6 sm:flex sm:items-center">
            <button
              type="button"
              className="relative rounded-full p-1 text-gray-400 hover:text-white focus:outline-2 focus:outline-offset-2 focus:outline-[#0178a3]"
            >
              <span className="absolute -inset-1.5" />
              <span className="sr-only">View notifications</span>
              <BellIcon aria-hidden="true" className="size-6" />
            </button>

            <Menu as="div" className="relative ml-3">
              <MenuButton className="relative flex max-w-xs items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0178a3]">
                <span className="absolute -inset-1.5" />
                <span className="sr-only">Open user menu</span>
                {user.imageUrl ? (
                  <img
                    alt=""
                    src={user.imageUrl}
                    className="size-8 rounded-full outline -outline-offset-1 outline-white/10"
                  />
                ) : (
                  <span className="flex size-8 items-center justify-center rounded-full bg-[#0178a3] text-sm font-medium text-white outline -outline-offset-1 outline-white/10">
                    {user.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                  </span>
                )}
              </MenuButton>

              <MenuItems
                transition
                className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-gray-800 py-1 outline -outline-offset-1 outline-white/10 transition data-closed:scale-95 data-closed:transform data-closed:opacity-0 data-enter:duration-200 data-enter:ease-out data-leave:duration-75 data-leave:ease-in"
              >
                {userNavigation.map((item) => (
                  <MenuItem key={item.name}>
                    {item.name === 'Sign out' && onSignOut ? (
                      <button
                        onClick={onSignOut}
                        className="block w-full text-left px-4 py-2 text-sm text-gray-300 data-focus:bg-white/5 data-focus:outline-hidden"
                      >
                        {item.name}
                      </button>
                    ) : (
                      <a
                        href={item.href}
                        className="block px-4 py-2 text-sm text-gray-300 data-focus:bg-white/5 data-focus:outline-hidden"
                      >
                        {item.name}
                      </a>
                    )}
                  </MenuItem>
                ))}
              </MenuItems>
            </Menu>
          </div>
          <div className="-mr-2 flex items-center sm:hidden">
            <DisclosureButton className="group relative inline-flex items-center justify-center rounded-md bg-[#202020] p-2 text-gray-400 hover:bg-white/5 hover:text-white focus:outline-2 focus:outline-offset-2 focus:outline-[#0178a3]">
              <span className="absolute -inset-0.5" />
              <span className="sr-only">Open main menu</span>
              <Bars3Icon aria-hidden="true" className="block size-6 group-data-open:hidden" />
              <XMarkIcon aria-hidden="true" className="hidden size-6 group-data-open:block" />
            </DisclosureButton>
          </div>
        </div>
      </div>

      <DisclosurePanel
        transition
        className="fixed inset-0 z-50 flex origin-top flex-col bg-[#202020] transition duration-300 ease-out data-closed:-translate-y-full data-closed:opacity-0 sm:hidden"
      >
        {/* Top bar with logo + close */}
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <img alt={logoAlt} src={logoSrc} className="h-8 w-auto" />
          <DisclosureButton className="relative -mr-2 inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-white/5 hover:text-white focus:outline-2 focus:outline-offset-2 focus:outline-[#0178a3]">
            <span className="absolute -inset-0.5" />
            <span className="sr-only">Close main menu</span>
            <XMarkIcon aria-hidden="true" className="size-6" />
          </DisclosureButton>
        </div>

        {/* User info */}
        <div className="flex items-center gap-3 px-5 pt-2 pb-4">
          <div className="shrink-0">
            {user.imageUrl ? (
              <img
                alt=""
                src={user.imageUrl}
                className="size-10 rounded-full outline -outline-offset-1 outline-white/10"
              />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-full bg-[#0178a3] text-sm font-medium text-white outline -outline-offset-1 outline-white/10">
                {user.name.split(' ').map(n => n[0]).join('').toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium text-white">{user.name}</div>
          </div>
          <button
            type="button"
            className="relative shrink-0 rounded-full p-1 text-gray-400 hover:text-white focus:outline-2 focus:outline-offset-2 focus:outline-[#0178a3]"
          >
            <span className="absolute -inset-1.5" />
            <span className="sr-only">View notifications</span>
            <BellIcon aria-hidden="true" className="size-6" />
          </button>
        </div>

        {/* Nav cards */}
        <div className="flex-1 space-y-2 overflow-y-auto px-4 pt-4">
          {navigation.map((item) => (
            <DisclosureButton
              key={item.name}
              as="a"
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              className={classNames(
                item.current
                  ? 'bg-[#2a2a2a] text-[#0178a3] ring-1 ring-[#0178a3]'
                  : 'bg-[#2a2a2a] text-gray-300 hover:text-white',
                'block rounded-2xl px-5 py-4 text-base font-medium transition-colors',
              )}
            >
              {item.name}
            </DisclosureButton>
          ))}
        </div>

        {/* Sign out */}
        <div className="shrink-0 px-4 pt-2 pb-6">
          {onSignOut && (
            <DisclosureButton
              as="button"
              onClick={onSignOut}
              className="block w-full rounded-2xl bg-[#2a2a2a] px-5 py-4 text-left text-base font-medium text-gray-400 hover:text-white"
            >
              Sign out
            </DisclosureButton>
          )}
        </div>
      </DisclosurePanel>
    </Disclosure>
  )
}
