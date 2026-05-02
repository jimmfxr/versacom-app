'use client'

import { useState } from 'react'

const CATEGORY_LABELS: Record<string, string> = {
  panels: 'Panels',
  wireless_bp: 'Wireless beltpack',
  hardwire_bp: 'Hardwire beltpack',
  switches: 'Switches',
  antennas: 'Antennas',
  audio: 'Audio I/O',
}

const CATEGORY_ORDER = ['panels', 'wireless_bp', 'hardwire_bp', 'switches', 'antennas', 'audio']

/**
 * Minimum shape required to build a location summary. Mapped from the project
 * page's EquipmentItem and the /tasks page's GearItem.
 */
export type LocationSummaryGear = {
  id: number
  name: string
  category: string
  hardwareType: string | null
  headsetType: string | null
  /** The location this piece of gear lives at — already resolved by the
   *  caller (e.g. equipment.location for infra, assignee.location for
   *  panels). Empty/null means the gear isn't placed yet. */
  effectiveLocation: string | null
  /** Panel-only misc accessories. Optional — non-panel categories may omit. */
  gooseneck?: boolean
  footswitches?: number
  speakers?: number
}

type LocationSummaryData = {
  byCategory: Array<{
    category: string
    label: string
    items: Array<{
      id: number
      name: string
      hardwareType: string | null
      headsetType: string | null
      gooseneck: boolean
      footswitches: number
      speakers: number
    }>
  }>
  headsets: Array<{ type: string; count: number }>
  totalGear: number
}

export function buildLocationSummary(
  allGear: LocationSummaryGear[],
  location: string,
): LocationSummaryData {
  const atLocation = allGear.filter((g) => g.effectiveLocation === location)

  const byCategory = CATEGORY_ORDER.map((cat) => {
    const inCat = atLocation.filter((g) => g.category === cat)
    if (inCat.length === 0) return null
    const items = inCat
      .map((g) => ({
        id: g.id,
        name: g.name || '(unnamed)',
        hardwareType: g.hardwareType,
        headsetType: g.headsetType,
        gooseneck: g.gooseneck ?? false,
        footswitches: g.footswitches ?? 0,
        speakers: g.speakers ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return {
      category: cat,
      label: CATEGORY_LABELS[cat] ?? cat,
      items,
    }
  }).filter((g): g is NonNullable<typeof g> => g !== null)

  const headsetMap = new Map<string, number>()
  for (const g of atLocation) {
    if (g.headsetType && g.headsetType.trim()) {
      const key = g.headsetType.trim()
      headsetMap.set(key, (headsetMap.get(key) ?? 0) + 1)
    }
  }
  const headsets = Array.from(headsetMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  return { byCategory, headsets, totalGear: atLocation.length }
}

/**
 * Collapsible "what's at this location" card. Same component used on the
 * crew /tasks page and the admin/manager Equipment tab so the gear breakdown
 * looks identical in both places.
 */
export function LocationSummary({
  location,
  allGear,
}: {
  location: string
  allGear: LocationSummaryGear[]
}) {
  const summary = buildLocationSummary(allGear, location)
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="mb-4 rounded-2xl bg-[#2a2a2a] p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={!collapsed}
      >
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Pull list
          </div>
          <div className="text-base font-semibold text-white">{location}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#22a7d3]/15 px-2.5 py-1 text-xs font-semibold text-[#22a7d3]">
            {summary.totalGear} {summary.totalGear === 1 ? 'item' : 'items'}
          </span>
          <svg
            className={`size-4 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {!collapsed && (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Gear
            </div>
            {summary.byCategory.length === 0 ? (
              <div className="text-xs text-gray-500">No gear at this location.</div>
            ) : (
              <div className="space-y-3">
                {summary.byCategory.map((g) => (
                  <div key={g.category}>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      {g.label}
                      <span className="ml-1.5 text-gray-500">{g.items.length}</span>
                    </div>
                    <div className="space-y-0.5">
                      {g.items.map((item) => (
                        <div key={item.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          <span className="font-mono font-semibold tabular-nums text-[#22a7d3]">
                            {item.name}
                          </span>
                          <span className="text-gray-200">
                            {item.hardwareType || (
                              <span className="italic text-gray-500">no model</span>
                            )}
                          </span>
                          {item.headsetType && (
                            <span className="text-xs text-gray-500">· {item.headsetType}</span>
                          )}
                          {item.gooseneck && (
                            <span className="text-xs text-gray-500">· Gooseneck</span>
                          )}
                          {item.footswitches > 0 && (
                            <span className="text-xs text-gray-500">· FS {item.footswitches}</span>
                          )}
                          {item.speakers > 0 && (
                            <span className="text-xs text-gray-500">· SPK {item.speakers}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Headsets needed
            </div>
            {summary.headsets.length === 0 ? (
              <div className="text-xs text-gray-500">
                None — no gear at this location has a headset assigned.
              </div>
            ) : (
              <div className="space-y-1">
                {summary.headsets.map((h) => (
                  <div key={h.type} className="flex items-baseline gap-2 text-sm">
                    <span className="font-mono font-semibold tabular-nums text-[#22a7d3]">
                      {h.count}×
                    </span>
                    <span className="text-gray-200">{h.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
