'use client'

import { useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import {
  BrowseProjectDropdown,
  BrowseMemberSwitcher,
  SiblingGearRow,
} from './panel-studio'

/**
 * Sibling component to PanelStudio. Rendered when the URL carries
 * `?radio=<id>` — i.e. the operator tapped a radio chip in the sibling
 * gear row. The page mirrors PanelStudio's outermost layout 1:1:
 *   - Viewport-locked flex column (100dvh - navbar)
 *   - Self mode: PageHeader title "My Equipment" + bottomBorder
 *   - Browse mode: 3-col grid (title left, member switcher CENTER,
 *     project dropdown right) on desktop; stacked on mobile.
 *   - Sibling-gear chip row underneath
 *   - Body where the chassis would be: a stack of zone cards listing
 *     every channel for the show, all expanded by default.
 *
 * Above the zone cards we render a single strip that names the active
 * radio + assignee (RAD 1 · First Last · Department · Position) so the
 * operator always sees whose radio they're looking at.
 */

type SiblingGear = {
  id: number
  name: string
  category: string
  hardwareType: string | null
}

type Zone = {
  id: number
  name: string
  channels: Array<{ channelIndex: number; name: string | null }>
}

type BrowseProject = { id: number; name: string; firstEquipmentId: number | null }
type BrowseMember = {
  id: number
  memberId: number
  firstName: string
  lastName: string
  position: string | null
  displayName: string
  equipmentId: number | null
  equipmentName: string | null
}

export function RadioStudio({
  project,
  equipment,
  radio,
  zones,
  siblingGear,
  browseProjects,
  browseMembers,
}: {
  project: { id: number; name: string }
  /** Panel context the operator was on when they tapped the radio
   *  chip. Anchors BrowseMemberSwitcher's prev/next and keeps the
   *  sibling-gear row referring to the same member. */
  equipment: { id: number; name: string }
  radio: {
    id: number
    name: string
    firstName: string | null
    lastName: string | null
    department: string | null
    position: string | null
  }
  zones: Zone[]
  siblingGear: SiblingGear[] | undefined
  browseProjects: BrowseProject[] | undefined
  browseMembers: BrowseMember[] | undefined
}) {
  const isBrowseMode = !!browseProjects && !!browseMembers

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 56px)' }}>
      <div className="flex flex-1 overflow-hidden relative min-h-0">
        <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden relative">
          {/* ── Header ─────────────────────────────────────────── */}
          {!isBrowseMode && (
            <div className="relative flex-shrink-0 pt-5">
              <PageHeader
                title="My Equipment"
                titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
                bottomBorder
              />
            </div>
          )}

          {isBrowseMode && browseProjects && browseMembers && (
            <div className="flex-shrink-0 mx-auto w-full max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
              {/* Mobile: title row → divider → project → member.
                  Matches the panel-studio mobile layout 1:1. */}
              <div className="flex flex-col gap-2 sm:hidden">
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  My Equipment
                </h1>
                <div className="w-full border-b-2 border-white/20" />
                <BrowseProjectDropdown project={project} browseProjects={browseProjects} />
                <div className="pt-2">
                  <BrowseMemberSwitcher
                    project={project}
                    currentEquipmentId={equipment.id}
                    browseMembers={browseMembers}
                  />
                </div>
              </div>
              {/* Desktop: 3-col grid — title left, member CENTER,
                  project right. Same as panel-studio. */}
              <div className="hidden grid-cols-3 items-center gap-3 sm:grid">
                <h1 className="justify-self-start text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  My Equipment
                </h1>
                <div className="justify-self-center">
                  <BrowseMemberSwitcher
                    project={project}
                    currentEquipmentId={equipment.id}
                    browseMembers={browseMembers}
                  />
                </div>
                <div className="justify-self-end">
                  <BrowseProjectDropdown project={project} browseProjects={browseProjects} />
                </div>
              </div>
            </div>
          )}

          {/* Divider under browse-mode header on desktop only (the
              non-browse PageHeader already has bottomBorder). */}
          {isBrowseMode && (
            <div className="flex-shrink-0 mx-auto hidden w-full max-w-7xl px-4 pt-4 sm:block sm:px-6 lg:px-8">
              <div className="border-b-2 border-white/20" />
            </div>
          )}

          {/* Sibling-gear chip row — current radio is active. */}
          {siblingGear && siblingGear.length > 1 && (
            <div className="flex-shrink-0">
              <SiblingGearRow
                gear={siblingGear}
                currentEquipmentId={-radio.id}
                projectId={project.id}
              />
            </div>
          )}

          {/* ── Body ───────────────────────────────────────────── */}
          <main className="flex min-h-0 flex-1 flex-col">
            <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-4 pt-4 sm:px-6 lg:px-8">
              {/* Identity strip — same typography + sizing as the
                  panel-studio identity row so the radio screen reads
                  consistent with the panel screen. RAD ID is cyan +
                  mono; assignee name is white; department / position
                  drop to a smaller gray meta row beneath. */}
              <div className="mb-4 flex-shrink-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[18px] font-bold text-[#22a7d3] font-mono lg:text-[22px]">
                    {radio.name}
                  </span>
                  {(radio.firstName || radio.lastName) && (
                    <>
                      <span className="text-xs text-[#3a3a3a]">·</span>
                      <span className="text-[18px] font-bold text-white truncate lg:text-[22px]">
                        {`${radio.firstName ?? ''} ${radio.lastName ?? ''}`.trim()}
                      </span>
                    </>
                  )}
                  {(radio.department || radio.position) && (
                    <>
                      <span className="text-xs text-[#3a3a3a]">·</span>
                      <span className="text-[13px] text-gray-400">
                        {[radio.department, radio.position].filter(Boolean).join(' · ')}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Scrollable zone-card list. */}
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none pb-20">
                {zones.length === 0 ? (
                  <EmptyState
                    icon={
                      <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                      </svg>
                    }
                    title="No zones set up yet"
                    message="An admin needs to add radio channel zones for this show first."
                  />
                ) : (
                  <div className="space-y-3">
                    {zones.map((zone) => (
                      <ZoneReadCard key={zone.id} zone={zone} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

/** Read-only collapsible zone card. Default = expanded so every
 *  channel is visible on landing. */
function ZoneReadCard({ zone }: { zone: Zone }) {
  const [collapsed, setCollapsed] = useState(false)
  const byIndex = new Map<number, string | null>()
  for (const ch of zone.channels) byIndex.set(ch.channelIndex, ch.name)

  return (
    <div className="border-b border-white/[0.06]">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-3 px-2 py-3 text-left transition-colors hover:bg-white/[0.04]"
      >
        <span className="text-sm font-semibold text-white">{zone.name}</span>
        <svg
          className={`size-4 shrink-0 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {!collapsed && (
        <div className="px-2 pb-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 16 }, (_, i) => i + 1).map((idx) => {
              const name = byIndex.get(idx) ?? null
              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-[#202020] px-2.5 py-1.5"
                >
                  <span className="w-6 shrink-0 text-right font-mono text-xs text-gray-500">
                    {String(idx).padStart(2, '0')}
                  </span>
                  <span className={`truncate text-sm ${name ? 'text-white' : 'text-gray-600'}`}>
                    {name ?? '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
