'use client'

import { useEffect, useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import type { NavItem } from '@/components/navbar'
import { JoinQrModal } from '@/components/join-qr-modal'

/**
 * Slide-up sheet triggered from the Toolbox slot on the BottomNav.
 * Contains every nav item that doesn't have its own bottom-tab slot
 * (Dashboard, Notifications, Profile are excluded — they each have
 * their own icon). The project-context shortcuts (Scanner / QR /
 * Kiosk) also live here when a project is selected.
 *
 * Sign out is intentionally absent — it lives on /profile.
 *
 * Animation: backdrop fade + translate-y-full → 0. Tap backdrop or
 * the X to close. ESC closes too.
 */

type Props = {
  open: boolean
  onClose: () => void
  /** Full nav array as built by AppShell — we filter Dashboard /
   *  Notifications / Profile out so we don't duplicate the bottom
   *  tabs. */
  navigation: ReadonlyArray<NavItem>
  /** Current project id — when set we render the 3-up Scanner / QR
   *  / Kiosk shortcut grid at the bottom of the sheet. */
  currentProjectId: string | null
  /** Current project name — used as the title of the join-QR modal
   *  ("Join — 2026 WWE" etc). */
  currentProjectName: string | null
}

const HIDDEN_HREFS = new Set(['/', '/notifications', '/profile'])

export function ToolsSheet({
  open,
  onClose,
  navigation,
  currentProjectId,
  currentProjectName,
}: Props) {
  // QR modal lives at the sheet level so we don't have to drill yet
  // another open-handler up to AppShell. Opening it closes the sheet
  // first so the QR modal isn't visually layered on top of the sheet.
  const [qrOpen, setQrOpen] = useState(false)
  // Close on ESC for keyboard users.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Filter out items that already have their own bottom-tab slot,
  // then promote Projects above Tasks per the operator-preferred
  // ordering — Projects is the more frequent jump-off for daily
  // work, Tasks lives one click further down.
  const filtered = navigation.filter((n) => !HIDDEN_HREFS.has(n.href))
  const items = [...filtered].sort((a, b) => {
    const order = (href: string) => {
      if (href === '/projects') return 0
      if (href === '/tasks' || href === '/admin') return 1
      return 2
    }
    const ao = order(a.href)
    const bo = order(b.href)
    if (ao !== bo) return ao - bo
    // Stable — preserve original navigation order for everything
    // outside the two we explicitly re-rank.
    return filtered.indexOf(a) - filtered.indexOf(b)
  })

  return (
    <>
    {/* Join-QR modal — sibling of the sheet so it's interactive even
        when the sheet is closed (the trigger closes the sheet first
        and then opens the modal). */}
    <JoinQrModal
      open={qrOpen}
      onClose={() => setQrOpen(false)}
      projectId={currentProjectId}
      projectName={currentProjectName}
    />
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-50 sm:hidden ${open ? '' : 'pointer-events-none'}`}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tools menu"
        className={`absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-[#202020] pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 transition-transform duration-200 ease-out ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Grabber + header row with close */}
        <div className="mb-2 flex flex-col items-center gap-2">
          <span className="h-1 w-10 rounded-full bg-white/20" aria-hidden />
        </div>
        {/* Header row — "Tools" label left, project name centered
            in cyan, X close right. relative so the centered project
            name can sit on the same row without being shoved by
            either side's width. */}
        <div className="relative flex items-center justify-between px-4 pb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Tools
          </span>
          {currentProjectName && (
            <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 truncate px-12 text-sm font-semibold text-[#22a7d3]">
              {currentProjectName}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tools"
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <XMarkIcon className="size-5" />
          </button>
        </div>

        {/* Nav items as cards — same chrome as the legacy mobile
            disclosure panel. */}
        <div className="flex flex-col gap-2 px-4 pb-4">
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={item.current ? 'page' : undefined}
              className={`flex items-center justify-center gap-2 rounded-lg border px-5 py-4 text-base font-medium transition-[colors,transform] duration-100 active:scale-[0.98] active:border-[#0178a3] active:bg-[#0178a3] active:text-white ${
                item.current
                  ? 'border-[#0178a3] text-[#22a7d3]'
                  : 'border-white/10 text-gray-200 hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              <span>{item.name}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </a>
          ))}
        </div>

        {/* Project-context shortcuts — Scanner / QR / Kiosk. Same
            3-up grid as the legacy disclosure menu. Only when a
            project is selected. */}
        {currentProjectId && (
          <div className="px-4 pt-1">
            {/* No section header / border — the project name in the
                Tools header above already establishes the context,
                so the 3-up shortcut grid flows straight from the
                nav cards. */}
            <div className="grid grid-cols-3 gap-2">
              <a
                href={`/radios/scan?project=${currentProjectId}`}
                onClick={onClose}
                aria-label="Scan radio barcode"
                className="flex items-center justify-center rounded-lg border border-white/10 px-5 py-4 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
              >
                <svg className="size-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5m0 9V18A2.25 2.25 0 0 1 18 20.25h-1.5m-9 0H6A2.25 2.25 0 0 1 3.75 18v-1.5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              </a>
              <button
                type="button"
                onClick={() => {
                  // Close the sheet first so the QR modal isn't
                  // visually layered on top — opens with a clean
                  // backdrop.
                  onClose()
                  setQrOpen(true)
                }}
                aria-label="Show join QR"
                className="flex items-center justify-center rounded-lg border border-white/10 px-5 py-4 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
              >
                <svg className="size-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
                </svg>
              </button>
              <a
                href={`/projects/${currentProjectId}/kiosk`}
                onClick={onClose}
                aria-label="Open kiosk"
                className="flex items-center justify-center rounded-lg border border-white/10 px-5 py-4 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
              >
                <svg className="size-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V6Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21h7.5M12 18v3" />
                </svg>
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  )
}
