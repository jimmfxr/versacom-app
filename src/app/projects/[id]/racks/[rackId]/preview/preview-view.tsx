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
// Bumped from 8/6 → 16/12 so the cards breathe inside the frame
// rather than crowding the rounded corners.
const PAD_X = 16
const PAD_Y = 12

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
      <div className="mb-2 text-center text-[10px] uppercase tracking-wider text-gray-500">
        {side}
      </div>
      <div
        className="relative rounded-lg border border-white/10"
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
                  className="flex w-full items-center pr-4 text-xs font-medium text-gray-600"
                  style={{ height: `${RU_PX - 2}px` }}
                >
                  <span className="w-9 shrink-0 text-center text-xs font-mono tabular-nums text-gray-400">{ru}</span>
                  <span className="min-w-0 flex-1 truncate text-center uppercase tracking-wider text-[10px]">Empty</span>
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
            className="flex items-center gap-2 rounded-lg bg-[#2a2a2a] pr-3 text-xs font-medium text-white"
          >
            <span className="w-9 shrink-0 self-stretch flex flex-col items-center justify-around py-0.5 font-mono tabular-nums text-[10px] text-[#22a7d3]">
              {Array.from({ length: s.ruSize }, (_, i) => (
                <span key={i}>{s.ruPosition + i}</span>
              ))}
            </span>
            <span className="min-w-0 flex-1 truncate text-center">{s.label}</span>
          </div>
        ))}
      </div>
      {/* Caster wheels under the chassis — two small dark circles
          spaced toward the outer edges, so the framed rack reads
          as a real wheeled rack on the road. Connected to the
          chassis via thin 'mounting brackets' (tiny stems) for a
          touch of physicality. */}
      <div className="flex items-start justify-between px-6">
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
  rack,
  slots,
}: {
  projectId: number
  rackTemplateId: number
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
      {/* Header: rack name + location + RU on the left;
          X close on the right. (Front/Rear dropdown removed —
          desktop shows both faces, mobile uses a carousel.) */}
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-white truncate">{rack.name}</span>
          {rack.location && (
            <>
              <span className="text-sm text-gray-600">·</span>
              <span className="text-sm text-[#22a7d3] truncate">{rack.location}</span>
            </>
          )}
          <span className="text-sm text-gray-600">·</span>
          <span className="text-sm text-gray-500 font-mono tabular-nums">{rack.totalRU}RU</span>
        </div>
        <Link
          href={`/projects/${projectId}?tab=racks&expand=${rackTemplateId}`}
          aria-label="Close rack preview"
          className="flex h-9 shrink-0 items-center text-gray-400 transition-colors hover:text-white"
        >
          <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </Link>
      </header>

      {/* DESKTOP: both faces side-by-side, sharing a row. The flex-1
          parent vertically centers the pair in the viewport so the
          chassis hovers in the middle of the page regardless of the
          page's height. */}
      <div className="hidden md:flex flex-1 items-center justify-center gap-8 py-6">
        <Chassis side="front" slots={slots} totalRU={rack.totalRU} />
        <Chassis side="rear" slots={slots} totalRU={rack.totalRU} />
      </div>

      {/* MOBILE: horizontal scroll-snap carousel. Each slide is one
          full container width wide, snap-mandatory locks it in
          place. Cyan dot indicators below track + control the
          active slide. */}
      <div className="md:hidden flex flex-1 flex-col py-6">
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
