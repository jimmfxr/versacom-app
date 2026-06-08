'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from '@headlessui/react'
import { Bars3Icon, BellIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useDrag } from '@use-gesture/react'
import { QRCodeSVG } from 'qrcode.react'
import { Modal } from './modal'

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
  /** Currently-active project context — drives the Scanner / QR /
   *  Kiosk chrome buttons in the nav. Both are nullable so we hide
   *  the buttons entirely on routes with no project context (login,
   *  profile, notifications, etc.). */
  readonly currentProjectId?: string | null
  readonly currentProjectName?: string | null
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
  currentProjectId,
  onShowQr,
}: {
  open: boolean
  close: () => void
  navigation: ReadonlyArray<NavItem>
  user: NavUser
  logoSrc: string
  logoAlt: string
  onSignOut?: () => void
  notificationUnread?: number
  currentProjectId: string | null
  onShowQr: () => void
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
          // `group` so the initials chip can invert on press (white
          // bg + cyan glyph) — matches the desktop avatar press state.
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-md transition-colors"
        >
          <div className="shrink-0">
            {user.imageUrl ? (
              <img
                alt=""
                src={user.imageUrl}
                className="size-10 rounded-full outline -outline-offset-1 outline-white/10"
              />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-full bg-[#0178a3] text-sm font-medium text-white outline -outline-offset-1 outline-white/10 transition-colors group-active:bg-white group-active:text-[#0178a3]">
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
          // Press state mirrors the desktop bell — cyan fill + white
          // glyph — so taps register identically on mobile.
          className="relative shrink-0 rounded-full p-1 text-gray-400 transition-colors hover:text-white active:bg-[#0178a3] active:text-white focus:outline-2 focus:outline-offset-2 focus:outline-[#0178a3]"
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
            className={classNames(
              item.current
                ? 'border border-[#0178a3] text-[#22a7d3]'
                : 'border border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04]',
              // Press feedback: cyan-fill chip-active + tiny scale-down
              // so the tap reads as a tactile-feeling press, no sound
              // needed. iPad / desktop / mobile all get this.
              // justify-center keeps the name + optional badge as a
              // centered group inside the chip (was justify-between,
              // which pinned the name left and the badge right).
              'flex items-center justify-center gap-2 rounded-lg px-5 py-4 text-base font-medium transition-[colors,transform] duration-100 active:scale-[0.98] active:border-[#0178a3] active:bg-[#0178a3] active:text-white',
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

      {/* Project chrome — Scanner / QR / Kiosk in a 3-up grid of
          squared icon buttons. Only renders when there's a current
          project context. Sits directly above the Sign out button
          per the v2.3 nav refresh. */}
      {currentProjectId && (
        <div className="shrink-0 px-4 pt-2">
          <div className="grid grid-cols-3 gap-2">
            <DisclosureButton
              as="a"
              href={`/radios/scan?project=${currentProjectId}`}
              aria-label="Scan radio barcode"
              className="flex items-center justify-center rounded-lg border border-white/10 px-5 py-4 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
            >
              <svg className="size-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5m0 9V18A2.25 2.25 0 0 1 18 20.25h-1.5m-9 0H6A2.25 2.25 0 0 1 3.75 18v-1.5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </DisclosureButton>
            <DisclosureButton
              as="button"
              onClick={onShowQr}
              aria-label="Show join QR"
              className="flex items-center justify-center rounded-lg border border-white/10 px-5 py-4 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
            >
              <svg className="size-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
              </svg>
            </DisclosureButton>
            <DisclosureButton
              as="a"
              href={`/projects/${currentProjectId}/kiosk`}
              aria-label="Open kiosk"
              className="flex items-center justify-center rounded-lg border border-white/10 px-5 py-4 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
            >
              <svg className="size-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V6Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21h7.5M12 18v3" />
              </svg>
            </DisclosureButton>
          </div>
        </div>
      )}

      {/* Sign out */}
      <div className="shrink-0 px-4 pt-2 pb-6">
        {onSignOut && (
          <DisclosureButton
            as="button"
            onClick={onSignOut}
            className="block w-full rounded-lg border border-white/10 px-5 py-4 text-center text-base font-medium text-gray-200 transition-colors duration-100 hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
          >
            Sign out
          </DisclosureButton>
        )}
      </div>
    </DisclosurePanel>
  )
}

/** ms the cyan-chip press effect lingers on a nav link after click. */
const NAV_PRESS_LINGER_MS = 500

export function Navbar({
  navigation,
  user,
  logoSrc = DEFAULT_LOGO_SRC,
  logoAlt = 'Clair',
  onSignOut,
  notificationUnread = 0,
  currentProjectId = null,
  currentProjectName = null,
}: NavbarProps) {
  // Tracks which nav link was most recently pressed so we can render a
  // lingering cyan chip around it for ~1s after the tap. Pure CSS
  // :active only holds while the pointer is down — we want the press
  // acknowledgment to outlive the click so the user *sees* it before
  // the route change completes.
  const [pressedHref, setPressedHref] = useState<string | null>(null)
  const pressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function markPressed(href: string) {
    if (pressTimeoutRef.current) clearTimeout(pressTimeoutRef.current)
    setPressedHref(href)
    pressTimeoutRef.current = setTimeout(() => {
      setPressedHref(null)
    }, NAV_PRESS_LINGER_MS)
  }

  // Project-scoped chrome modal (join QR). Opened from the Scanner/
  // QR/Kiosk button cluster in the nav; closes via backdrop tap or X.
  // The PIN is fetched lazily on open so the navbar doesn't have to
  // know the PIN ahead of time.
  const [qrOpen, setQrOpen] = useState(false)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrPin, setQrPin] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  function openQr() {
    if (!currentProjectId) return
    setQrOpen(true)
    setQrLoading(true)
    setQrError(null)
    setQrPin(null)
    fetch(`/api/projects/${currentProjectId}/pin`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed (${res.status})`)
        }
        const data = (await res.json()) as { pin: string }
        setQrPin(data.pin)
      })
      .catch((e) => {
        setQrError(e instanceof Error ? e.message : 'Unable to load QR')
      })
      .finally(() => setQrLoading(false))
  }
  function closeQr() {
    setQrOpen(false)
    setQrPin(null)
    setQrError(null)
  }
  const joinUrl =
    qrPin != null ? `https://versacom-app.vercel.app/login/join?pin=${qrPin}` : null
  const hasProjectContext = !!currentProjectId
  return (
    <>
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
                <div className="hidden sm:-my-px sm:ml-6 sm:flex sm:items-center sm:space-x-1">
                  {navigation.map((item) => {
                    const pressed = pressedHref === item.href
                    return (
                    <Link
                      key={item.name}
                      href={item.href}
                      aria-current={item.current ? 'page' : undefined}
                      onMouseDown={() => markPressed(item.href)}
                      onTouchStart={() => markPressed(item.href)}
                      style={{ touchAction: 'manipulation' }}
                      className={classNames(
                        // Pressed state takes priority: a solid cyan
                        // chip wraps the text + icon for ~1s so the tap
                        // is unmistakably acknowledged.
                        pressed
                          ? 'bg-[#0178a3] text-white'
                          : item.current
                            ? 'text-white'
                            : 'text-gray-400 hover:text-gray-200',
                        // Active-route underline is now a child span
                        // (see below) instead of a full-width border-b
                        // on the link itself. The link is just a chip
                        // with relative positioning so the underline
                        // can sit beneath the TEXT only, not the chip's
                        // rounded outline.
                        //
                        // Padding matched to the standard Button (Edit /
                        // Save / etc) — px-4 py-2 text-sm rounded-lg —
                        // so the nav strip reads at the same chip size
                        // as the rest of the app's primary actions.
                        'relative inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-300',
                      )}
                    >
                      {item.name}
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                      {/* Active-route indicator: a short, flat cyan
                          underline that sits below the text only, NOT
                          the full chip width. inset-x-2 trims the
                          line in by exactly the link's horizontal
                          padding so it reads as a clean straight bar
                          beneath the text rather than tracing the
                          chip's rounded corners. Hidden during the
                          press flash so the chip stays uncluttered. */}
                      {item.current && !pressed && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-x-4 -bottom-px h-0.5 bg-[#0178a3]"
                        />
                      )}
                    </Link>
                    )
                  })}
                </div>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:items-center sm:gap-2">
                {/* Project-scoped chrome — Scanner, QR, Kiosk. Sits
                    left of the notification bell. Hidden when there
                    is no current project context (login, profile,
                    notifications etc.). All three are simple icon
                    buttons matching the size of the bell. */}
                {hasProjectContext && (
                  <div className="flex items-center gap-1">
                    <a
                      href={`/radios/scan?project=${currentProjectId}`}
                      aria-label="Scan radio barcode"
                      title="Scanner"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-white active:bg-[#0178a3] active:text-white"
                    >
                      <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5m0 9V18A2.25 2.25 0 0 1 18 20.25h-1.5m-9 0H6A2.25 2.25 0 0 1 3.75 18v-1.5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                    </a>
                    <button
                      type="button"
                      onClick={openQr}
                      aria-label="Show join QR"
                      title="Join QR"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-white active:bg-[#0178a3] active:text-white"
                    >
                      <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
                      </svg>
                    </button>
                    <a
                      href={`/projects/${currentProjectId}/kiosk`}
                      aria-label="Open kiosk"
                      title="Kiosk"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-white active:bg-[#0178a3] active:text-white"
                    >
                      <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V6Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21h7.5M12 18v3" />
                      </svg>
                    </a>
                  </div>
                )}
                <a
                  href="/notifications"
                  // Press state: bell fills cyan, glyph white. Matches
                  // the chrome icon-press language used elsewhere in
                  // the nav.
                  className="relative rounded-full p-1 text-gray-400 transition-colors hover:text-white active:bg-[#0178a3] active:text-white focus:outline-2 focus:outline-offset-2 focus:outline-[#0178a3]"
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
                  // `group` so the initials chip can flip its colors
                  // via group-active: when the link is pressed
                  // (white bg + cyan glyph — the inverse of its
                  // default cyan-bg/white-glyph state).
                  className="group relative ml-3 flex max-w-xs items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0178a3]"
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
                    <span className="flex size-8 items-center justify-center rounded-full bg-[#0178a3] text-sm font-medium text-white outline -outline-offset-1 outline-white/10 transition-colors group-active:bg-white group-active:text-[#0178a3]">
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
            currentProjectId={currentProjectId}
            onShowQr={() => {
              close()
              openQr()
            }}
          />
        </>
      )}
    </Disclosure>

    {/* Join-QR modal — opened from either the desktop chrome strip
        or the mobile slide-down. Renders the QR for the current
        project's join URL. PIN is fetched lazily via /api on open. */}
    <Modal
      open={qrOpen}
      onClose={closeQr}
      title={currentProjectName ? `Join — ${currentProjectName}` : 'Join QR'}
    >
      {qrLoading && (
        <div className="flex h-64 items-center justify-center text-sm text-gray-400">
          Loading…
        </div>
      )}
      {qrError && (
        <p className="py-4 text-center text-sm text-red-400">{qrError}</p>
      )}
      {!qrLoading && !qrError && joinUrl && (
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="rounded-2xl bg-white p-4">
            <QRCodeSVG value={joinUrl} size={220} level="M" />
          </div>
          <span className="break-all text-center font-mono text-[11px] text-gray-400">
            {joinUrl}
          </span>
        </div>
      )}
    </Modal>
    </>
  )
}
