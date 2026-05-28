'use client'

import { useEffect, useRef, useState } from 'react'

type Channel = { channelIndex: number; name: string | null }
type Zone = { id: number; name: string; channels: Channel[] }

export function ZonesCarousel({ zones }: { zones: Zone[] }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  // Track which card is centered in the scroll viewport so the dots
  // below can mirror the user's position. IntersectionObserver with a
  // narrow horizontal root margin gives us a single "active" card at a
  // time. Disabled on sm+ where the layout becomes a 2-up grid and
  // dots are hidden anyway.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const cards = Array.from(track.querySelectorAll<HTMLElement>('[data-zone-card]'))
    if (cards.length === 0) return

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (!visible) return
        const idx = cards.indexOf(visible.target as HTMLElement)
        if (idx !== -1) setActive(idx)
      },
      { root: track, threshold: [0.5, 0.75, 1] },
    )
    cards.forEach((c) => io.observe(c))
    return () => io.disconnect()
  }, [zones.length])

  const scrollTo = (i: number) => {
    const track = trackRef.current
    if (!track) return
    const card = track.querySelectorAll<HTMLElement>('[data-zone-card]')[i]
    if (!card) return
    track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: 'smooth' })
  }

  return (
    <>
      <div
        ref={trackRef}
        className="mt-6 -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0"
      >
        {zones.map((zone) => (
          <section
            key={zone.id}
            data-zone-card
            className="w-full shrink-0 snap-center rounded-xl border border-white/10 bg-[#2a2a2a] p-4 sm:w-auto sm:shrink sm:snap-align-none sm:p-5"
          >
            <h2 className="text-base font-semibold text-white">{zone.name}</h2>
            {zone.channels.length === 0 ? (
              <p className="mt-2 text-xs text-gray-500">No channels assigned.</p>
            ) : (
              <ol className="mt-3 divide-y divide-white/[0.06]">
                {zone.channels.map((ch) => (
                  <li
                    key={ch.channelIndex}
                    className="flex items-baseline gap-3 py-2 text-sm"
                  >
                    <span className="w-6 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums text-gray-300">
                      {ch.channelIndex}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-white">
                      {ch.name?.trim() || <span className="font-normal text-gray-600">—</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>

      {/* Pagination dots — mobile only (hidden at sm+ where the grid
          shows all zones at once). Cyan for the active card, white/20
          for the rest. Tapping a dot jumps to that card. */}
      {zones.length > 1 && (
        <div className="mt-4 flex justify-center gap-2 sm:hidden">
          {zones.map((z, i) => (
            <button
              key={z.id}
              type="button"
              aria-label={`Go to ${z.name}`}
              onClick={() => scrollTo(i)}
              className={`h-2 w-2 rounded-full transition-colors ${
                i === active ? 'bg-[#22a7d3]' : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      )}
    </>
  )
}
