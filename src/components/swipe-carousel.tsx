'use client'

import { Children, useEffect, useRef, useState } from 'react'

type Props = {
  children: React.ReactNode
  /** Tailwind classes to hide the carousel above a breakpoint, e.g. 'sm:hidden'.
   *  Default: 'sm:hidden' so it only shows on mobile. */
  hiddenAbove?: string
}

/**
 * Generic horizontal swipe-snap carousel with Instagram-style dot indicators.
 * Each direct child becomes one slide. Slide width = container width.
 *
 * Use case: replace a small grid of cards on mobile with swipeable single-card view.
 * Pair this with a parent that hides the carousel and shows the grid at sm+.
 */
export function SwipeCarousel({ children, hiddenAbove = 'sm:hidden' }: Props) {
  const slides = Children.toArray(children)
  const trackRef = useRef<HTMLDivElement>(null)
  const slideRefs = useRef<Array<HTMLDivElement | null>>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new IntersectionObserver(
      (entries) => {
        let best: IntersectionObserverEntry | null = null
        for (const e of entries) {
          if (!e.isIntersecting) continue
          if (!best || e.intersectionRatio > best.intersectionRatio) best = e
        }
        if (!best) return
        const idx = slideRefs.current.findIndex((el) => el === best!.target)
        if (idx >= 0) setActive(idx)
      },
      { root: track, threshold: [0.5, 0.75, 1] },
    )
    slideRefs.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [slides.length])

  function jumpTo(i: number) {
    const slide = slideRefs.current[i]
    slide?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  if (slides.length === 0) return null

  return (
    <div className={hiddenAbove}>
      <div
        ref={trackRef}
        // touch-action: manipulation — allow BOTH horizontal pans
        // (carousel snap) AND vertical pans (page scroll) so a finger
        // landing on the carousel can still swipe up/down to reach
        // content rendered below it (e.g. the Radios card). Previously
        // this was `pan-x`, which on some browsers (Chrome Android)
        // strictly blocked vertical pans within the carousel — making
        // anything past the carousel unreachable from mobile.
        // overscroll-behavior: contain still prevents a swipe past the
        // first/last slide from rubber-banding the whole page.
        style={{ touchAction: 'manipulation', overscrollBehavior: 'contain' }}
        className="-mx-2 flex snap-x snap-mandatory items-stretch overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((child, i) => (
          <div
            key={i}
            ref={(el) => {
              slideRefs.current[i] = el
            }}
            className="flex w-full shrink-0 snap-center px-2"
          >
            <div className="w-full">{child}</div>
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        // pb-2 + scroll-mt-4 below the dots so when this section is
        // the last thing in a scroll container the dots aren't flush
        // with the boundary / safe-area inset on iPhones.
        <div className="mt-4 pb-2 flex items-center justify-center gap-2">
          {slides.map((_, i) => {
            const isActive = i === active
            return (
              <button
                key={i}
                type="button"
                onClick={() => jumpTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={`h-2 rounded-full transition-all ${
                  isActive ? 'w-5 bg-[#22a7d3]' : 'w-2 bg-white/[0.25] hover:bg-white/40'
                }`}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
