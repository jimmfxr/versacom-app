'use client'

import { useState, useEffect, useRef } from 'react'

/**
 * Floating "scroll to top" button. Watches:
 *   1. window.scrollY (regular page scroll), AND
 *   2. any element with `data-scroll-container` attribute (inner scroll
 *      regions used by the kiosk-style project / tasks / projects pages).
 *
 * Whichever is scrolled past 300px wins — clicking the button scrolls
 * that element back to the top.
 */
export function ScrollToTop() {
  const [visible, setVisible] = useState(false)
  const targetRef = useRef<HTMLElement | Window>(typeof window !== 'undefined' ? window : null as unknown as Window)

  useEffect(() => {
    function update() {
      // Inner scroll containers take priority: if any is scrolled past
      // the threshold, surface that one. Falls back to the window.
      const containers = Array.from(
        document.querySelectorAll<HTMLElement>('[data-scroll-container]'),
      )
      for (const c of containers) {
        if (c.scrollTop > 300) {
          targetRef.current = c
          setVisible(true)
          return
        }
      }
      if (window.scrollY > 300) {
        targetRef.current = window
        setVisible(true)
        return
      }
      setVisible(false)
    }

    update()
    // capture: true catches scroll events from descendant scroll
    // containers (regular bubbling doesn't fire `scroll`).
    document.addEventListener('scroll', update, true)
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('scroll', update)
    }
  }, [])

  if (!visible) return null

  return (
    <button
      onClick={() => {
        const t = targetRef.current
        if (t === window || t === null) {
          window.scrollTo({ top: 0, behavior: 'smooth' })
        } else if (t instanceof HTMLElement) {
          t.scrollTo({ top: 0, behavior: 'smooth' })
        }
      }}
      // Mobile: standard 24px gutter (default right-6).
      // Desktop: align with the page gutter inside max-w-7xl so the
      // button lines up with the row-card edit buttons instead of
      // overlapping them at the viewport edge. Offset adds 2rem (= the
      // lg:px-8 page gutter) so the button sits at the inner padding
      // of the content area.
      className="fixed bottom-6 right-6 sm:right-[max(2rem,calc((100vw-80rem)/2+2rem))] z-50 flex size-11 items-center justify-center rounded-full bg-[#0178a3] text-white shadow-lg transition-opacity hover:bg-[#019bc7] active:scale-95"
      aria-label="Scroll to top"
    >
      <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
      </svg>
    </button>
  )
}
