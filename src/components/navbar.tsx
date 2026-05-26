'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from '@headlessui/react'
import { Bars3Icon, BellIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useDrag } from '@use-gesture/react'
import { triggerHaptic } from '@/lib/haptic'

export type NavItem = {
  readonly name: string
  readonly href: string
  readonly current?: boolean
  /** Optional count rendered as a small pill next to the item name. */
  readonly badge?: number
}

export type NavUser = {
  readonly name: string
  readonly email: string
  readonly imageUrl: string
}

export type NavbarProps = {
  readonly navigation: ReadonlyArray<NavItem>
  readonly user: NavUser
  readonly logoSrc?: string
  readonly logoAlt?: string
  readonly onSignOut?: () => void
  /** Count of unread in-app notifications for the current user.
   *  Drives the small cyan dot on the bell icon. 0 hides it. */
  readonly notificationUnread?: number
}

function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

const DEFAULT_LOGO_SRC = '/clair_logo_white.png'

// Drag-to-dismiss thresholds
const DISMISS_FRACTION = 0.3 // dragged > 30% of viewport height → dismiss
const FLICK_VELOCITY = 0.5 // OR upward velocity > 0.5 px/ms → dismiss
const SETTLE_MS = 200 // snap-back / animate-out duration

/**
 * Mobile nav panel with drag-to-dismiss. Renders the standard Headless UI
 * panel with an inline `translate3d` transform driven by the user's finger.
 * On release, the panel either snaps back to fully open or animates fully
 * off-screen and then asks Headless UI to close.
 */
function MobileNavPanel({
  open,
  close,
  navigation,
  user,
  logoSrc,
  logoAlt,
  onSignOut,
  notificationUnread = 0,
}: {
  open: boolean
  close: () => void
  navigation: ReadonlyArray<NavItem>
  user: NavUser
  logoSrc: string
  logoAlt: string
  onSignOut?: () => void
  notificationUnread?: number
}) {
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)

  // Reset state only on a fresh open (closed → open transition). Resetting
  // on close would cause a 1-frame flash where the panel snaps back to its
  // open position before Headless UI's leave animation runs — looks like
  // the panel briefly "comes back down" right at the end of a dismiss.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setDragY(0)
      setDragging(false)
    }
    wasOpenRef.current = open
  }, [open])

  const bind = useDrag(
    ({ movement: [, my], direction: [, dy], velocity: [, vy], down, last }) => {
      // Active drag — follow the finger, but only upward (clamp at 0).
      if (down) {
        setDragging(true)
        setDragY(Math.min(0, my))
        return
      }

      // Release — decide whether to dismiss or snap back.
      if (last) {
        setDragging(false)
        const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 0
        const dragged = Math.abs(my)
        const flickedUp = dy === -1 && vy > FLICK_VELOCITY
        const shouldDismiss = dragged > screenHeight * DISMISS_FRACTION || flickedUp

        if (shouldDismiss) {
          // Animate the rest of the way off-screen, then ask Headless UI to
          // close. The inline transform stays in place across the close so
          // there's no visual snap.
          setDragY(-screenHeight)
          setTimeout(() => close(), SETTLE_MS)
        } else {
          setDragY(0)
        }
      }
    },
    { axis: 'y', filterTaps: true, pointer: { touch: true } },
  )

  // Override Headless UI's transition whenever we're holding a non-zero
  // offset — including AFTER close() has been called. This keeps the panel
  // pinned off-screen while Headless UI runs its leave animation in the
  // background, preventing the 1-frame "snap back down" flash. When the
  // panel reopens, the state reset above clears dragY and the regular
  // data-closed:* CSS handles the open animation.
  const useInlineTransform = dragging || dragY !== 0

  return (
    <DisclosurePanel
      transition
      className="fixed inset-0 z-50 flex origin-top flex-col bg-[#202020] transition duration-300 ease-out data-closed:-translate-y-full data-closed:opacity-0 sm:hidden"
      style={{
        ...(useInlineTransform
          ? {
              transform: `translate3d(0, ${dragY}px, 0)`,
              transition: dragging ? 'none' : `transform ${SETTLE_MS}ms ease-out`,
            }
          : {}),
        touchAction: 'none',
      }}
      {...bind()}
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

      {/* User info — tap the avatar / name to jump to /profile. The
          mobile panel doesn't have its own dropdown chrome, so this row
          doubles as the profile entry point. */}
      <div className="flex items-center gap-3 px-5 pt-2 pb-4">
        <a
          href="/profile"
          onClick={() => close()}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md transition-colors"
        >
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
        </a>
        <a
          href="/notifications"
          onClick={() => close()}
          className="relative shrink-0 rounded-full p-1 text-gray-400 hover:text-white focus:outline-2 focus:outline-offset-2 focus:outline-[#0178a3]"
        >
          <span className="absolute -inset-1.5" />
          <span className="sr-only">
            View notifications{notificationUnread > 0 ? ` (${notificationUnread} unread)` : ''}
          </span>
          <BellIcon aria-hidden="true" className="size-6" />
          {/* Unread badge — small cyan pill on the bell, same chrome
              as the desktop variant. Mobile panel background is the
              same #202020 so the ring blends naturally. */}
          {notificationUnread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 inline-flex min-h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[#202020]"
            >
              {notificationUnread > 9 ? '9+' : notificationUnread}
            </span>
          )}
        </a>
      </div>

      {/* Nav cards */}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 pt-4">
        {navigation.map((item) => (
          <DisclosureButton
            key={item.name}
            as="a"
            href={item.href}
            aria-current={item.current ? 'page' : undefined}
            // Audio-click haptic for iPadOS / desktop, vibrate on
            // Android. Matches the desktop nav-strip behaviour.
            onMouseDown={triggerHaptic}
            onTouchStart={triggerHaptic}
            className={classNames(
              item.current
                ? 'border border-[#0178a3] text-[#22a7d3]'
                : 'border border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04]',
              // Press feedback: cyan-fill chip-active style so the
              // tap is visibly acknowledged before navigation
              // completes — same chip system as the rest of the app.
              'flex items-center justify-between gap-2 rounded-lg px-5 py-4 text-base font-medium transition-colors duration-100 active:border-[#0178a3] active:bg-[#0178a3] active:text-white',
            )}
          >
            <span>{item.name}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </DisclosureButton>
        ))}
      </div>

      {/* Sign out */}
      <div className="shrink-0 px-4 pt-2 pb-6">
        {onSignOut && (
          <DisclosureButton
            as="button"
            onClick={onSignOut}
            className="block w-full rounded-lg border border-white/10 px-5 py-4 text-left text-base font-medium text-gray-200 transition-colors duration-100 hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
          >
            Sign out
          </DisclosureButton>
        )}
      </div>
    </DisclosurePanel>
  )
}

export function Navbar({
  navigation,
  user,
  logoSrc = DEFAULT_LOGO_SRC,
  logoAlt = 'Clair',
  onSignOut,
  notificationUnread = 0,
}: NavbarProps) {
  return (
    <Disclosure as="nav" className="sticky top-0 z-40 bg-[#202020]">
      {({ open, close }) => (
        <>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 justify-between">
              <div className="flex">
                <div className="flex shrink-0 items-center">
                  <img alt={logoAlt} src={logoSrc} className="h-8 w-auto" />
                </div>
                {/* sm:items-center stops the links from stretching to
                    the full h-16 navbar height — without it, the link's
                    border-b-2 sits at the navbar bottom (~28px below
                    the text). With items-center the link only spans
                    its content + pt-1 + the 2px border, so the active
                    indicator hugs the underline of the text. */}
                <div className="hidden sm:-my-px sm:ml-6 sm:flex sm:items-center sm:space-x-8">
                  {navigation.map((item) => (
                    <a
                      key={item.name}
                      href={item.href}
                      aria-current={item.current ? 'page' : undefined}
                      // Cross-platform tap feedback for the desktop /
                      // iPad nav strip. Tries navigator.vibrate first
                      // (Android), falls back to a short Web Audio
                      // click on iPadOS / desktop where vibrate no-ops.
                      onMouseDown={triggerHaptic}
                      onTouchStart={triggerHaptic}
                      className={classNames(
                        item.current
                          ? 'border-[#0178a3] text-white'
                          : 'border-transparent text-gray-400 hover:border-white/20 hover:text-gray-200',
                        'inline-flex items-center gap-1.5 border-b-2 px-1 pt-1 text-sm font-medium',
                      )}
                    >
                      {item.name}
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:items-center">
                <a
                  href="/notifications"
                  className="relative rounded-full p-1 text-gray-400 hover:text-white focus:outline-2 focus:outline-offset-2 focus:outline-[#0178a3]"
                >
                  <span className="absolute -inset-1.5" />
                  <span className="sr-only">
                    View notifications{notificationUnread > 0 ? ` (${notificationUnread} unread)` : ''}
                  </span>
                  <BellIcon aria-hidden="true" className="size-6" />
                  {/* Unread badge — small cyan dot in the top-right
                      corner of the bell. Hidden at 0 so the icon
                      stays clean when there's nothing new. */}
                  {notificationUnread > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-0.5 -top-0.5 inline-flex min-h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[#202020]"
                    >
                      {notificationUnread > 9 ? '9+' : notificationUnread}
                    </span>
                  )}
                </a>

                {/* Avatar is a direct link to /profile — the old
                    dropdown (notifications toggle + sign-out) is gone:
                    notifications settings live on /notifications, and
                    sign-out moved into the profile page. */}
                <a
                  href="/profile"
                  className="relative ml-3 flex max-w-xs items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0178a3]"
                >
                  <span className="absolute -inset-1.5" />
                  <span className="sr-only">Open profile</span>
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
                </a>
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

          <MobileNavPanel
            open={open}
            close={close}
            navigation={navigation}
            user={user}
            logoSrc={logoSrc}
            logoAlt={logoAlt}
            onSignOut={onSignOut}
            notificationUnread={notificationUnread}
          />
        </>
      )}
    </Disclosure>
  )
}
