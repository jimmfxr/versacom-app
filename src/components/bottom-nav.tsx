'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  HomeIcon,
  BriefcaseIcon,
  BellIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
// Solid variants — swapped in for the active tab so the chosen
// slot reads as "selected", matching Google / iOS bottom nav
// conventions (outline = inactive, solid = active).
import {
  HomeIcon as HomeIconSolid,
  BriefcaseIcon as BriefcaseIconSolid,
  BellIcon as BellIconSolid,
  UserCircleIcon as UserCircleIconSolid,
} from '@heroicons/react/24/solid'
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
 * User-only crew (isUserOnly): the toolbox is dropped entirely —
 * scanner / QR / kiosk / radios / etc. all live in the toolbox and
 * user-role accounts can't access any of them (proxy.ts blocks the
 * routes server-side too). With nothing for the toolbox to open,
 * the tab bar collapses to three slots: Home (→ /my-equipment, the
 * user's only landing page), Notifications, Profile.
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
  /** True for crew with `role=user`. Hides the toolbox tab (they
   *  can't access scanner/QR/kiosk anyway) and reroutes Home to
   *  /my-equipment instead of the Dashboard. */
  isUserOnly?: boolean
}

export function BottomNav({ notificationUnread, onOpenTools, toolsActive, isUserOnly = false }: Props) {
  const pathname = usePathname() ?? ''
  // Home destination depends on role. User-only sessions don't have
  // a dashboard surface — their "home" is the My Equipment list.
  const homeHref = isUserOnly ? '/my-equipment' : '/'
  const isHome = isUserOnly ? pathname.startsWith('/my-equipment') : pathname === '/'
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
      label: isUserOnly ? 'My Equipment' : 'Dashboard',
      href: homeHref,
      Icon: HomeIcon,
      ActiveIcon: HomeIconSolid,
      active: isHome,
    },
    // Toolbox is dropped entirely for user-only sessions — see top-
    // of-file comment for why.
    ...(isUserOnly
      ? []
      : [{
          key: 'tools' as const,
          label: 'Tools',
          onClick: onOpenTools,
          Icon: BriefcaseIcon,
          ActiveIcon: BriefcaseIconSolid,
          active: toolsActive && !isHome && !isNotifications && !isProfile,
        }]),
    {
      key: 'bell',
      label: 'Notifications',
      href: '/notifications',
      Icon: BellIcon,
      ActiveIcon: BellIconSolid,
      active: isNotifications,
      // Numeric badge (capped at 99+ in the render) — replaces the
      // previous bare red dot so users can see the actual unread count
      // without opening the notifications page.
      badge: notificationUnread,
    },
    {
      key: 'profile',
      label: 'Profile',
      href: '/profile',
      Icon: UserCircleIcon,
      ActiveIcon: UserCircleIconSolid,
      active: isProfile,
    },
  ] as const

  const slidePx = progress * navHeight
  // Grid columns adapt to how many tabs we ended up rendering — 3 for
  // user-only (no toolbox), 4 for everyone else.
  const gridCols = isUserOnly ? 'grid-cols-3' : 'grid-cols-4'
  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      aria-hidden={progress > 0.5}
      className={`fixed inset-x-0 bottom-0 z-40 grid ${gridCols} bg-[#1a1a1a] pb-[max(2.75rem,env(safe-area-inset-bottom))] pt-5 sm:hidden`}
      // Same 180ms ease-out as AutoHideHeader — keeps the top and
      // bottom chrome moving in sync visually.
      style={{ transform: `translateY(${slidePx}px)`, transition: 'transform 180ms ease-out' }}
    >
      {items.map((item) => {
        const color = item.active ? 'text-[#22a7d3]' : 'text-gray-400'
        // Solid icon when the tab is active (Google / Material You
        // pattern); outline icon when inactive.
        const RenderIcon = item.active ? item.ActiveIcon : item.Icon
        const inner = (
          <>
            {'badge' in item && typeof item.badge === 'number' && item.badge > 0 && (
              <span
                aria-hidden
                className="absolute right-[calc(50%-18px)] top-0 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
              >
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
            <RenderIcon className="size-7" aria-hidden />
          </>
        )
        // Press feedback — quick scale-down + faint bg flash so the
        // tap registers visually even before navigation. transition
        // covers both color (active swap) and transform (press).
        const base = `relative flex items-center justify-center transition-[colors,transform] duration-150 ease-out active:scale-90 active:bg-white/[0.05] ${color}`
        return 'href' in item ? (
          <Link
            key={item.key}
            href={item.href}
            aria-label={item.label}
            aria-current={item.active ? 'page' : undefined}
            style={{ touchAction: 'manipulation' }}
            className={base}
          >
            {inner}
          </Link>
        ) : (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            aria-label={item.label}
            style={{ touchAction: 'manipulation' }}
            className={base}
          >
            {inner}
          </button>
        )
      })}
    </nav>
  )
}
