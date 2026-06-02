'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FilterDropdown } from '@/components/filter-dropdown'

const RU_PX = 48

type Slot = {
  id: number
  ruPosition: number
  ruSize: number
  side: string
  label: string
}

/**
 * Client-side body of the Rack Preview page. Owns the Front/Rear
 * side toggle (FilterDropdown), filters slots by side, and renders
 * the read-only chassis. The server wrapper pre-fetches BOTH sides
 * of slots in one query so toggling sides is instant — no extra
 * round trip.
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
  const [side, setSide] = useState<'front' | 'rear'>('front')
  const sideSlots = slots.filter((s) => s.side === side)
  const occupied = new Set<number>()
  for (const s of sideSlots) {
    for (let i = 0; i < s.ruSize; i++) occupied.add(s.ruPosition + i)
  }
  const containerHeight = rack.totalRU * RU_PX + 8

  return (
    <>
      {/* Header: rack name + location + RU on the left;
          Front/Rear dropdown + X close on the right. */}
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
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-32">
            <FilterDropdown
              ariaLabel="Rack side"
              value={side}
              onChange={(v) => setSide(v as 'front' | 'rear')}
              widthClass="w-full"
              options={[
                { value: 'front', label: 'Front' },
                { value: 'rear', label: 'Rear' },
              ]}
            />
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
        </div>
      </header>

      {/* Chassis (read-only): same RU_PX math + slot card chrome
          as the editable studio, just no Edit / drag handlers. */}
      {/* Chassis area takes the remaining vertical space and
          centers the rack frame inside it — page reads as a single
          framed rack hovering in the viewport. max-w-xs narrows
          the rack so it doesn't sprawl on wide screens. */}
      <div className="flex flex-1 flex-col items-center justify-center py-6">
      <div className="w-full max-w-xs">
      <div
        className="relative rounded-lg border border-white/10"
        style={{ height: `${containerHeight}px` }}
      >
        {Array.from({ length: rack.totalRU }, (_, i) => {
          const ru = i + 1
          const isEmpty = !occupied.has(ru)
          return (
            <div
              key={`ru-${ru}`}
              className="flex items-center"
              style={{
                position: 'absolute',
                top: `${i * RU_PX + 4}px`,
                left: 0,
                right: 0,
                height: `${RU_PX}px`,
              }}
            >
              {isEmpty && (
                <div className="flex h-[46px] w-full items-center pr-4 text-sm font-medium text-gray-600">
                  <span className="w-9 shrink-0 text-center text-sm font-mono tabular-nums text-gray-400">{ru}</span>
                  <span className="min-w-0 flex-1 truncate text-center uppercase tracking-wider text-xs">Empty</span>
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
              top: `${(s.ruPosition - 1) * RU_PX + 4}px`,
              left: 0,
              right: 0,
              height: `${s.ruSize * RU_PX - 2}px`,
            }}
            className="flex w-full items-center gap-2 rounded-lg bg-[#2a2a2a] pr-4 text-sm font-medium text-white"
          >
            <span className="w-9 shrink-0 self-stretch flex flex-col items-center justify-around py-1 font-mono tabular-nums text-sm text-[#22a7d3]">
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
      </div>
    </>
  )
}
