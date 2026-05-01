'use client'

import { useEffect, useRef, useState } from 'react'

type Step = { num: number; title: string; desc: string; img: string; alt: string }

type Props = {
  steps: Step[]
}

function PhoneFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="mx-auto w-full max-w-[180px] sm:max-w-[200px]">
      <div className="rounded-[2.4rem] border-[5px] border-white/[0.12] bg-[#0d0d0d] p-1.5 shadow-2xl shadow-black/60">
        <div className="overflow-hidden rounded-[2rem] bg-[#111]">
          <div className="flex justify-center py-2">
            <div className="h-1.5 w-14 rounded-full bg-white/[0.08]" />
          </div>
          <div className="aspect-[9/19] w-full overflow-hidden bg-[#111]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="h-full w-full object-contain object-top" />
          </div>
          <div className="flex justify-center py-2">
            <div className="h-1 w-10 rounded-full bg-white/[0.08]" />
          </div>
        </div>
      </div>
    </div>
  )
}

function StepCard({ step }: { step: Step }) {
  return (
    <div className="flex flex-col rounded-2xl bg-[#242424] p-5 pt-6">
      <PhoneFrame src={step.img} alt={step.alt} />
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="flex size-6 items-center justify-center rounded-full bg-[#22a7d3]/20 text-[11px] font-bold text-[#22a7d3]">
            {step.num}
          </span>
          <span className="text-sm font-semibold text-white">{step.title}</span>
        </div>
        <p className="text-sm leading-relaxed text-gray-400">{step.desc}</p>
      </div>
    </div>
  )
}

/**
 * Mobile: horizontal scroll-snap carousel with Instagram-style dot indicators.
 */
export function StepCarousel({ steps }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const slideRefs = useRef<Array<HTMLDivElement | null>>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the highest intersection ratio that's at least 50% visible.
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
  }, [steps.length])

  function jumpTo(i: number) {
    const slide = slideRefs.current[i]
    slide?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  return (
    <div>
      <div
        ref={trackRef}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {steps.map((step, i) => (
          <div
            key={step.num}
            ref={(el) => {
              slideRefs.current[i] = el
            }}
            className="w-full shrink-0 snap-center px-1"
          >
            <StepCard step={step} />
          </div>
        ))}
      </div>

      {/* Dots */}
      <div className="mt-5 flex items-center justify-center gap-2">
        {steps.map((step, i) => {
          const isActive = i === active
          return (
            <button
              key={step.num}
              type="button"
              onClick={() => jumpTo(i)}
              aria-label={`Go to step ${step.num}`}
              className={`h-2 rounded-full transition-all ${
                isActive ? 'w-5 bg-[#22a7d3]' : 'w-2 bg-white/[0.25] hover:bg-white/40'
              }`}
            />
          )
        })}
      </div>
    </div>
  )
}
