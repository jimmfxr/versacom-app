'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  HomeIcon,
  BriefcaseIcon,
  BellIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import { useHideProgress } from '@/lib/use-scroll-direction'

/**
 * Mobile-only bottom tab bar. Four icon buttons fixed to the
 * viewport bottom — Home (Dashboard), Toolbox (opens ToolsSheet),
 * Bell (Notifications), Profile.
 *
 * Active state is cyan; inactive is gray. The Toolbox button is
 * also "active" when the user is on any route that lives inside
 * the sheet (Projects / Tasks / Radios / etc.) so the operator
 * always knows which slot covers their current page.
 *
 * Rendered by AppShell when NEW_BOTTOM_NAV is on. Hidden on
 * /kiosk/* and /zones/* via the parent guard.
 */

type Props = {
  notificationUnread: number
  onOpenTools: () => void
  /** True when the active route is one of the items inside the
   *  Tools sheet — drives the cyan highlight on the toolbox icon. */
  toolsActive: boolean
}

export function BottomNav({ notificationUnread, onOpenTools, toolsActive }: Props) {
  const pathname = usePathname() ?? ''
  const isHome = pathname === '/'
  const isNotifications = pathname.startsWith('/notifications')
  const isProfile = pathname.startsWith('/profile')
  // Scroll-linked hide: progress 0..1 tracks the user's gesture
  // pixel-for-pixel rather than snapping when a direction threshold
  // is crossed. translateY = progress * navHeight slides the bar
  // out of view as they scroll down and back into view as they
  // scroll up, in step with the finger.
  const progress = useHideProgress()
  const navRef = useRef<HTMLElement>(null)
  const [navHeight, setNavHeight] = useState(0)
  useEffect(() => {
    const el = navRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setNavHeight(el.offsetHeight))
    ro.observe(el)
    setNavHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [])

  const items = [
    {
      key: 'home',
      label: 'Dashboard',
      href: '/',
      Icon: HomeIcon,
      active: isHome,
    },
    {
      key: 'tools',
      label: 'Tools',
      onClick: onOpenTools,
      Icon: BriefcaseIcon,
      active: toolsActive && !isHome && !isNotifications && !isProfile,
    },
    {
      key: 'bell',
      label: 'Notifications',
      href: '/notifications',
      Icon: BellIcon,
      active: isNotifications,
      dot: notificationUnread > 0,
    },
    {
      key: 'profile',
      label: 'Profile',
      href: '/profile',
      Icon: UserCircleIcon,
      active: isProfile,
    },
  ] as const

  const slidePx = progress * navHeight
  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      aria-hidden={progress > 0.5}
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 bg-[#1a1a1a] pb-[max(2.75rem,env(safe-area-inset-bottom))] pt-5 sm:hidden"
      style={{ transform: `translateY(${slidePx}px)` }}
    >
      {items.map((item) => {
        const color = item.active ? 'text-[#22a7d3]' : 'text-gray-400'
        const inner = (
          <>
            {'dot' in item && item.dot && (
              <span
                aria-hidden
                className="absolute right-[calc(50%-14px)] top-1 size-2 rounded-full bg-red-500"
              />
            )}
            <item.Icon className="size-7" aria-hidden />
          </>
        )
        const base = `relative flex items-center justify-center bg-transparent transition-colors ${color}`
        return 'href' in item ? (
          <a
            key={item.key}
            href={item.href}
            aria-label={item.label}
            aria-current={item.active ? 'page' : undefined}
            className={base}
          >
            {inner}
          </a>
        ) : (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            aria-label={item.label}
            className={base}
          >
            {inner}
          </button>
        )
      })}
    </nav>
  )
}
