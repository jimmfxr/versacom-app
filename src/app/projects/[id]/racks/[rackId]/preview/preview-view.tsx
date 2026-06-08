'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

// Smaller RU height than the editable studio (48px) so the entire
// rack fits on screen at a glance without scroll on common rack
// sizes (17 RU * 30px = 510px → comfortably fits viewport).
const RU_PX = 30

// Internal chassis padding — slot cards inset from the rounded
// border so they don't sit flush against the frame. Mirrors how a
// real rack has rails inside the cabinet walls, not at them.
// Bumped again (16/12 → 20/20) so the cards have generous
// breathing room and top/bottom gaps read as visually equal even
// with the caster wheels anchoring the bottom edge.
const PAD_X = 20
const PAD_Y = 20

// Explicit chassis width. Two of these render side-by-side on
// desktop and one fills the carousel slide on mobile — using a
// fixed pixel width (instead of w-full + max-w) prevents flex
// from over-allocating space and stretching the cards across the
// viewport. 320px keeps each rack proportional to its 522px
// height (17RU * 30px) so it reads as a rack, not a flat panel.
const CHASSIS_W = 320

type Slot = {
  id: number
  ruPosition: number
  ruSize: number
  side: string
  label: string
  /** Linked Equipment.location, when the slot is equipment-backed.
   *  Rendered in cyan next to the label so the operator can tell
   *  e.g. SW 1 (FOH) apart from SW 1 (Truss) at a glance. */
  linkedLocation?: string | null
  /** Linked Equipment.hardwareType (model). Rendered in dim gray
   *  next to the location, same color treatment as the library
   *  tile in the editable rack studio. */
  linkedHardwareType?: string | null
  /** Linked Equipment.ipAddress. Rendered in cyan after the model
   *  (or on its own row beneath the id/model for frames). Same
   *  treatment as the IP link on the Equipment tab + Switch Studio
   *  identity strip — drops the previous font-mono per operator
   *  feedback that all IPs should read with the same text style
   *  across the app. */
  linkedIpAddress?: string | null
  /** Linked Equipment.category. Drives the slot layout for frames
   *  specifically: a frame slot puts the IP on its own row below the
   *  id + model so the chassis card has a place to breathe. Switches
   *  + audio keep the inline single-row layout. */
  linkedCategory?: string | null
}

/**
 * Read-only chassis for a single side. Reused on both desktop
 * (Front + Rear render side-by-side, sharing a row) and mobile
 * (each side is a slide in the horizontal carousel). Same RU_PX
 * math + slot card chrome as the editable studio, just no Edit
 * affordances or drag handlers.
 */
function Chassis({
  side,
  slots,
  totalRU,
}: {
  side: 'front' | 'rear'
  slots: Slot[]
  totalRU: number
}) {
  const sideSlots = slots.filter((s) => s.side === side)
  const occupied = new Set<number>()
  for (const s of sideSlots) {
    for (let i = 0; i < s.ruSize; i++) occupied.add(s.ruPosition + i)
  }
  const containerHeight = totalRU * RU_PX + PAD_Y * 2

  return (
    <div className="shrink-0" style={{ width: `${CHASSIS_W}px` }}>
      {/* Side label above the chassis so the operator can tell at a
          glance which face they're looking at when both render
          together on desktop. */}
      <div className="mb-2 text-center text-[10px] uppercase tracking-wider text-gray-500 print:text-black">
        {side}
      </div>
      <div
        className="relative rounded-lg border border-white/10 print:border-2 print:border-black"
        style={{ height: `${containerHeight}px` }}
      >
        {Array.from({ length: totalRU }, (_, i) => {
          const ru = i + 1
          const isEmpty = !occupied.has(ru)
          return (
            <div
              key={`ru-${ru}`}
              className="flex items-center"
              style={{
                position: 'absolute',
                top: `${i * RU_PX + PAD_Y}px`,
                left: `${PAD_X}px`,
                right: `${PAD_X}px`,
                height: `${RU_PX}px`,
              }}
            >
              {isEmpty && (
                <div
                  className="flex w-full items-center text-xs font-medium text-gray-600 print:text-gray-600"
                  style={{ height: `${RU_PX - 2}px` }}
                >
                  <span className="w-9 shrink-0 text-center text-xs font-mono tabular-nums text-gray-400 print:text-black">{ru}</span>
                  <span className="min-w-0 flex-1 truncate text-center uppercase tracking-wider text-[10px] print:text-gray-600">Empty</span>
                  {/* Invisible spacer mirroring the RU number column
                      width on the left so the centered label is
                      truly centered relative to the WHOLE card
                      (not just the area to the right of the RU
                      column). */}
                  <span className="w-9 shrink-0" aria-hidden />
                </div>
              )}
            </div>
          )
        })}
        {sideSlots.map((s) => (
          <div
            key={s.id}
            style={{
              position: 'absolute',
              top: `${(s.ruPosition - 1) * RU_PX + PAD_Y}px`,
              left: `${PAD_X}px`,
              right: `${PAD_X}px`,
              height: `${s.ruSize * RU_PX - 2}px`,
            }}
            className="flex items-center rounded-lg bg-[#2a2a2a] text-xs font-medium text-white print:bg-transparent print:border-2 print:border-black print:text-black"
          >
            <span className="w-9 shrink-0 self-stretch flex flex-col items-center justify-around py-0.5 font-mono tabular-nums text-[10px] text-[#22a7d3] print:text-black">
              {Array.from({ length: s.ruSize }, (_, i) => (
                <span key={i}>{s.ruPosition + i}</span>
              ))}
            </span>
            {/* Frame layout: id + model on row 1, IP on row 2. Gives
                the frame card more breathing room since frames are
                typically 2U+ and have room for stacked text. Every
                other category keeps the inline single-row layout. */}
            {s.linkedCategory === 'frames' ? (
              <span className="min-w-0 flex-1 flex flex-col items-center justify-center gap-0.5 truncate px-2">
                <span className="flex items-baseline gap-1.5 truncate">
                  <span className="truncate print:text-black">{s.label}</span>
                  {s.linkedHardwareType && (
                    <span className="truncate text-[10px] text-gray-500 print:text-black">{s.linkedHardwareType}</span>
                  )}
                </span>
                {s.linkedIpAddress && (
                  <span className="truncate text-[10px] text-[#22a7d3] print:text-black">{s.linkedIpAddress}</span>
                )}
              </span>
            ) : (
              <span className="min-w-0 flex-1 flex items-baseline justify-center gap-1.5 truncate px-2">
                <span className="truncate print:text-black">{s.label}</span>
                {s.linkedHardwareType && (
                  <span className="truncate text-[10px] text-gray-500 print:text-black">{s.linkedHardwareType}</span>
                )}
                {s.linkedIpAddress && (
                  // IP uses the same color as the Equipment tab + Switch
                  // Studio identity strip — text-[#22a7d3], no font-
                  // mono. Operator wanted all IP rendering to read
                  // identically across the app.
                  <span className="truncate text-[10px] text-[#22a7d3] print:text-black">{s.linkedIpAddress}</span>
                )}
              </span>
            )}
            {/* Invisible spacer mirroring the RU number column width
                on the left so the centered label is truly centered
                relative to the WHOLE card (not just the area to the
                right of the RU column). */}
            <span className="w-9 shrink-0" aria-hidden />
          </div>
        ))}
      </div>
      {/* Caster wheels under the chassis — two small dark circles
          spaced toward the outer edges, so the framed rack reads
          as a real wheeled rack on the road. Connected to the
          chassis via thin 'mounting brackets' (tiny stems) for a
          touch of physicality. Decorative — hidden on print. */}
      <div className="flex items-start justify-between px-6 print:hidden">
        <div className="flex flex-col items-center">
          <div className="h-1 w-2 bg-white/10" />
          <div className="size-6 rounded-full bg-[#0a0a0a] border border-white/10 shadow-[0_2px_4px_rgba(0,0,0,0.4)]" />
        </div>
        <div className="flex flex-col items-center">
          <div className="h-1 w-2 bg-white/10" />
          <div className="size-6 rounded-full bg-[#0a0a0a] border border-white/10 shadow-[0_2px_4px_rgba(0,0,0,0.4)]" />
        </div>
      </div>
    </div>
  )
}

/**
 * Client body of the Rack Preview page.
 *
 * - Desktop (md+): Front + Rear chassis render side-by-side in a
 *   single row. No toggle needed — operators see both faces at once.
 * - Mobile (<md): horizontal scroll-snap carousel. Slide 0 = Front,
 *   slide 1 = Rear. Two cyan dot indicators below the chassis show
 *   which slide is visible; tapping a dot programmatically scrolls
 *   to that slide. The active dot tracks the user's swipe via a
 *   scroll listener on the carousel container.
 *
 * The server wrapper pre-fetches BOTH sides of slots in one query
 * so the carousel / desktop pair has all the data it needs upfront
 * — no extra round trips when switching faces.
 */
export function RackPreviewView({
  projectId,
  rackTemplateId,
  projectName,
  rack,
  slots,
}: {
  projectId: number
  rackTemplateId: number
  /** Project name — rendered first in the header so the printed
   *  sheet identifies which show this rack belongs to (crew running
   *  racks across multiple shows can sort the pages). Shows on
   *  screen too — operator wanted one consistent header. */
  projectName: string
  rack: {
    name: string
    location: string | null
    totalRU: number
  }
  slots: Slot[]
}) {
  const [activeSide, setActiveSide] = useState<'front' | 'rear'>('front')
  const carouselRef = useRef<HTMLDivElement>(null)

  // Track which slide is currently snapped into view on mobile.
  // The scroll-snap container is one viewport wide per slide, so
  // round(scrollLeft / clientWidth) tells us the slide index.
  useEffect(() => {
    const el = carouselRef.current
    if (!el) return
    const onScroll = () => {
      if (el.clientWidth === 0) return
      const idx = Math.round(el.scrollLeft / el.clientWidth)
      setActiveSide(idx === 0 ? 'front' : 'rear')
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const scrollToSide = (side: 'front' | 'rear') => {
    const el = carouselRef.current
    if (!el) return
    el.scrollTo({ left: side === 'front' ? 0 : el.clientWidth, behavior: 'smooth' })
  }

  return (
    <>
      {/* Header: show · rack name · location · RU on the left;
          Print + Close on the right. Show name was added so
          printed sheets identify the project. Print button left
          of Close triggers window.print(); the print styles strip
          colors / fills + hide chrome (Close, dots, wheels) so the
          paper output is just lines + black text. */}
      <header className="flex items-center justify-between gap-3 print:text-black">
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-white truncate print:text-black">{projectName}</span>
          <span className="text-sm text-gray-600 print:text-black">·</span>
          <span className="text-sm font-semibold text-white truncate print:text-black">{rack.name}</span>
          {rack.location && (
            <>
              <span className="text-sm text-gray-600 print:text-black">·</span>
              <span className="text-sm text-[#22a7d3] truncate print:text-black">{rack.location}</span>
            </>
          )}
          <span className="text-sm text-gray-600 print:text-black">·</span>
          <span className="text-sm text-gray-500 font-mono tabular-nums print:text-black">{rack.totalRU}RU</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 print:hidden">
          {/* Print button — fires window.print(); the @media print
              styles handle the rest. Sits left of the Close button
              per operator request. */}
          <button
            type="button"
            onClick={() => {
              // iOS PWA mode (page installed to home screen) BLOCKS
              // window.print() — the API silently no-ops in
              // standalone display-mode. Previous attempt to detour
              // via window.open(url, '_blank') failed too because
              // the PWA's manifest scope covers this URL, so the
              // "new tab" immediately routes back into the PWA.
              //
              // Current workaround: navigator.share() with the page
              // URL. KNOWN LIMITATION: iOS share sheet for a URL
              // does NOT include AirPrint — the Print option only
              // appears when sharing a FILE (PDF / image), not a
              // URL. So PWA operators get a share sheet without a
              // direct Print action; they have to pick "Open in
              // Safari" from it and re-tap Print there.
              //
              // TODO (post-DB-migration): replace this with a
              // proper PDF generation flow — server-side endpoint
              // (pdfkit or similar — Puppeteer is too heavy on
              // Vercel cold starts) that returns a vector PDF for
              // the rack. Single-tap → download PDF → AirPrint.
              // Works identically on PWA, Safari, desktop. Drops
              // the platform-detection logic below. Tracked in
              // product-decisions.md PD-030.
              const isStandalone =
                window.matchMedia?.('(display-mode: standalone)').matches ||
                (navigator as Navigator & { standalone?: boolean }).standalone === true
              if (isStandalone) {
                if (typeof navigator.share === 'function') {
                  navigator
                    .share({
                      title: 'Rack — print',
                      url: window.location.href,
                    })
                    .catch(() => {
                      // User cancelled the share sheet — no-op.
                    })
                } else {
                  alert(
                    'Printing is not supported in the installed app. Open this page in Safari to print.',
                  )
                }
                return
              }
              try {
                window.print()
              } catch {
                // ignore — webview / blocked context
              }
            }}
            aria-label="Print rack"
            title="Print rack"
            style={{ touchAction: 'manipulation' }}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-white active:bg-[#0178a3] active:text-white"
          >
            <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
            </svg>
          </button>
          {/* Close button — replaced the X icon-button with a labeled
              text button to match the close pattern used in Rack
              Studio, Panel Studio, and Switch Studio (consistent
              chrome across the studios). Returns to the project
              detail page with the racks tab open and the originating
              rack expanded. */}
          <Link
            href={`/projects/${projectId}?tab=racks&expand=${rackTemplateId}`}
            style={{ touchAction: 'manipulation' }}
            className="shrink-0 inline-flex rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
          >
            Close
          </Link>
        </div>
      </header>

      {/* DESKTOP (md+) and PRINT: both faces side-by-side, sharing a
          row. The flex-1 parent vertically centers the pair in the
          viewport so the chassis hovers in the middle of the page
          regardless of the page's height. print:flex forces this
          layout even on mobile printers — paper always gets both
          faces visible at once. */}
      <div className="hidden md:flex flex-1 items-center justify-center gap-8 py-6 print:flex!">
        <Chassis side="front" slots={slots} totalRU={rack.totalRU} />
        <Chassis side="rear" slots={slots} totalRU={rack.totalRU} />
      </div>

      {/* MOBILE (< md): horizontal scroll-snap carousel. Each slide
          is one full container width wide, snap-mandatory locks it
          in place. Cyan dot indicators below track + control the
          active slide. Hidden on print so the desktop side-by-side
          layout takes over. */}
      <div className="md:hidden flex flex-1 flex-col py-6 print:hidden">
        <div
          ref={carouselRef}
          className="flex flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="snap-center shrink-0 w-full flex items-center justify-center px-2">
            <Chassis side="front" slots={slots} totalRU={rack.totalRU} />
          </div>
          <div className="snap-center shrink-0 w-full flex items-center justify-center px-2">
            <Chassis side="rear" slots={slots} totalRU={rack.totalRU} />
          </div>
        </div>
        {/* Cyan dot indicators. Active dot is solid cyan, inactive
            is dim gray. Tapping a dot scrolls the carousel to that
            slide — same target the swipe gesture lands on. */}
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            type="button"
            aria-label="Show front of rack"
            onClick={() => scrollToSide('front')}
            className={`size-2 rounded-full transition-colors ${
              activeSide === 'front' ? 'bg-[#22a7d3]' : 'bg-gray-600'
            }`}
          />
          <button
            type="button"
            aria-label="Show rear of rack"
            onClick={() => scrollToSide('rear')}
            className={`size-2 rounded-full transition-colors ${
              activeSide === 'rear' ? 'bg-[#22a7d3]' : 'bg-gray-600'
            }`}
          />
        </div>
      </div>
    </>
  )
}
