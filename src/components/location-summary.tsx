'use client'

import { useState } from 'react'
import { STATUS_BADGE_STYLES, getStatusLabel } from '@/lib/deploy-status'
import { compareMultNames } from '@/lib/mults'

const CATEGORY_LABELS: Record<string, string> = {
  panels: 'Panels',
  wireless_bp: 'Wireless beltpack',
  hardwire_bp: 'Hardwire beltpack',
  switches: 'Switches',
  antennas: 'Antennas',
  audio: 'Audio I/O',
  mults: 'Mults',
}

const CATEGORY_ORDER = ['panels', 'wireless_bp', 'hardwire_bp', 'switches', 'antennas', 'audio', 'mults']

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
  /** Optional — when present, renders a small status pill on the gear row. */
  deployStatus?: string
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
      deployStatus: string | null
      cables: Array<{ label: string; count: number }>
    }>
  }>
  headsets: Array<{ type: string; count: number }>
  cables: Array<{ label: string; count: number }>
  /** Number of panels at this location with a gooseneck — also a physical
   *  pack item, so counted separately from the panel itself. */
  goosenecks: number
  /** Total speakers required across all panels at this location. */
  speakers: number
  /** Total physical items to pack: equipment rows + headsets + cables +
   *  goosenecks + speakers. Drives the badge in the card header. */
  totalGear: number
}

/**
 * Compute the cable accessories required for a single panel based on its
 * footswitch + speaker counts. Returns a compact, ordered list of
 * { label, count } entries — empty if the panel needs no cables.
 *
 * Rules:
 *  - 1× "1/4-XLRM" per footswitch
 *  - 1× "DB9-XLRF" per panel that has *any* footswitches (single DB9 covers
 *    up to all 3 footswitches on one panel)
 *  - 1× "RJ45-XLRMF" per speaker
 */
function cablesForPanel(footswitches: number, speakers: number) {
  const cables: Array<{ label: string; count: number }> = []
  if (footswitches > 0) {
    cables.push({ label: '1/4-XLRM', count: footswitches })
    cables.push({ label: 'DB9-XLRF', count: 1 })
  }
  if (speakers > 0) {
    cables.push({ label: 'RJ45-XLRMF', count: speakers })
  }
  return cables
}

// Statuses worth surfacing on the pull list. We skip 'na' (the default —
// adds no info) but include 'not-needed' so crew know not to grab those.
const VISIBLE_STATUSES = new Set(['deployed', 'done', 'returned', 'not-needed', 'damaged'])

export function buildLocationSummary(
  allGear: LocationSummaryGear[],
  location: string,
): LocationSummaryData {
  const atLocation = allGear.filter((g) => g.effectiveLocation === location)

  const byCategory = CATEGORY_ORDER.map((cat) => {
    const inCat = atLocation.filter((g) => g.category === cat)
    if (inCat.length === 0) return null
    const items = inCat
      .map((g) => {
        const fs = g.footswitches ?? 0
        const spk = g.speakers ?? 0
        return {
          id: g.id,
          name: g.name || '(unnamed)',
          hardwareType: g.hardwareType,
          headsetType: g.headsetType,
          gooseneck: g.gooseneck ?? false,
          footswitches: fs,
          speakers: spk,
          deployStatus: g.deployStatus ?? null,
          // Cables only apply to panels — other categories will return [].
          cables: cat === 'panels' ? cablesForPanel(fs, spk) : [],
        }
      })
      // Sort rule depends on the category:
      //   - Mults use letter-suffix IDs (FBR A → FBR Z → FBR AA …).
      //     compareMultNames sorts by suffix LENGTH first then
      //     alphabet so the doubled-letter convention reads "past Z"
      //     instead of "between A and B".
      //   - Everything else uses natural-number sort so
      //     "PNL 1, PNL 2, … PNL 10, PNL 11" reads in human order.
      .sort((a, b) => cat === 'mults'
        ? compareMultNames(a.name, b.name)
        : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
      )
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

  // Aggregate cable totals across every panel at this location, then sort by
  // a stable preferred ordering so the section reads consistently.
  const cableMap = new Map<string, number>()
  for (const g of atLocation) {
    if (g.category !== 'panels') continue
    for (const c of cablesForPanel(g.footswitches ?? 0, g.speakers ?? 0)) {
      cableMap.set(c.label, (cableMap.get(c.label) ?? 0) + c.count)
    }
  }
  const cableOrder = ['1/4-XLRM', 'DB9-XLRF', 'RJ45-XLRMF']
  const cables = Array.from(cableMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => cableOrder.indexOf(a.label) - cableOrder.indexOf(b.label))

  // Panel-only accessories that are separate physical pack items.
  const panels = atLocation.filter((g) => g.category === 'panels')
  const goosenecks = panels.filter((p) => p.gooseneck).length
  const speakers = panels.reduce((s, p) => s + (p.speakers ?? 0), 0)

  // Total = equipment rows + every separate physical pack item.
  const headsetsTotal = headsets.reduce((s, h) => s + h.count, 0)
  const cablesTotal = cables.reduce((s, c) => s + c.count, 0)
  const totalGear =
    atLocation.length + headsetsTotal + cablesTotal + goosenecks + speakers

  return { byCategory, headsets, cables, goosenecks, speakers, totalGear }
}

/**
 * Collapsible "what's at this location" card. Same component used on the
 * crew /tasks page and the admin/manager Equipment tab so the gear breakdown
 * looks identical in both places.
 */
export function LocationSummary({
  location,
  allGear,
  label = 'Pull list',
  plots = [],
}: {
  location: string
  allGear: LocationSummaryGear[]
  /** Header label — defaults to "Pull list", switches to "Return list" when
   *  the calling page is in return phase. */
  label?: string
  /** Project plots so the card can link to the matching PDF in-line.
   *  Match is case-insensitive on label (so "FOH" plot maps to FOH
   *  location). Optional — nothing renders when no match exists. */
  plots?: Array<{ id: number; label: string; url: string }>
}) {
  const summary = buildLocationSummary(allGear, location)
  const [collapsed, setCollapsed] = useState(false)
  // Find a plot whose label matches this location (case-insensitive).
  // Used to surface the "Open PDF" chip directly under the card's
  // Pull-list header so it's the first action crew see when opening
  // a location.
  const matchingPlot = plots.find(
    (p) => p.label.trim().toLowerCase() === location.trim().toLowerCase(),
  ) ?? null

  return (
    <div className="mb-4 border-b border-white/10 py-4 sm:py-5">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={!collapsed}
      >
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {label}
          </div>
          <div className="text-base font-semibold text-white">{location}</div>
        </div>
        <div className="flex items-center gap-2">
          {/* Item-count badge — borderless cyan label so it reads as
              a soft accent next to the location name rather than a
              tappable chip. Was a chip, but the cyan-bordered look
              competed visually with the plot chip directly below. */}
          <span className="inline-flex items-center px-1 text-xs font-medium text-[#22a7d3]">
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

      {/* Plot chip — sits directly under the Pull-list header so it's
          the first thing crew see when the card is open. Links to the
          matching stage-plot PDF (case-insensitive label match against
          this location). Hidden when collapsed or no matching plot. */}
      {!collapsed && matchingPlot && (
        <div className="mt-3 flex">
          <a
            href={matchingPlot.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-lg border border-[#22a7d3]/60 px-3 py-1.5 text-xs font-medium text-[#22a7d3] transition-colors hover:bg-[#22a7d3]/10"
          >
            {matchingPlot.label}
          </a>
        </div>
      )}
      {!collapsed && (
        // CSS multi-column flow on desktop. Each section (gear
        // category / Headsets / Cables / Misc) is an atomic block with
        // `break-inside-avoid`, so the browser auto-balances them
        // across 2 columns to minimise total card height. Long-tail
        // shows (lots of panels) used to dump the entire gear list
        // in the left column while the right column sat half-empty —
        // now the small categories fill that dead space automatically.
        <div className="mt-3 sm:columns-2 sm:gap-x-4 [&>*]:break-inside-avoid [&>*]:mb-4">
          {summary.byCategory.length === 0 ? (
            <div className="text-xs text-gray-500">No gear at this location.</div>
          ) : (
            summary.byCategory.map((g) => (
              <div key={g.category}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {g.label}
                  <span className="ml-1.5 text-gray-500">{g.items.length}</span>
                </div>
                <div className="space-y-1">
                  {g.items.map((item) => (
                    <div key={item.id}>
                      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
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
                        {item.deployStatus && VISIBLE_STATUSES.has(item.deployStatus) && (
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_BADGE_STYLES[item.deployStatus] || ''}`}>
                            {getStatusLabel(item.deployStatus)}
                          </span>
                        )}
                      </div>
                      {item.cables.length > 0 && (
                        <div className="ml-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-gray-500">
                          {item.cables.map((c, i) => (
                            <span key={c.label}>
                              {i > 0 && <span className="text-gray-600"> · </span>}
                              <span className="font-mono tabular-nums">{c.count}× </span>
                              {c.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {/* Headsets — same column flow as gear, lives wherever the
              column balancer decides to drop it. */}
          {summary.headsets.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Headsets needed
                <span className="ml-1.5 text-gray-500">{summary.headsets.length}</span>
              </div>
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
            </div>
          )}

          {/* Misc — goosenecks + speakers (panel-only accessories). */}
          {(summary.goosenecks > 0 || summary.speakers > 0) && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Misc accessories
              </div>
              <div className="space-y-1">
                {summary.goosenecks > 0 && (
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-mono font-semibold tabular-nums text-[#22a7d3]">
                      {summary.goosenecks}×
                    </span>
                    <span className="text-gray-200">Goosenecks</span>
                  </div>
                )}
                {summary.speakers > 0 && (
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-mono font-semibold tabular-nums text-[#22a7d3]">
                      {summary.speakers}×
                    </span>
                    <span className="text-gray-200">Speakers</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cables — derived from each panel's FS / SPK accessories. */}
          {summary.cables.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Cables needed
                <span className="ml-1.5 text-gray-500">{summary.cables.length}</span>
              </div>
              <div className="space-y-1">
                {summary.cables.map((c) => (
                  <div key={c.label} className="flex items-baseline gap-2 text-sm">
                    <span className="font-mono font-semibold tabular-nums text-[#22a7d3]">
                      {c.count}×
                    </span>
                    <span className="text-gray-200">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
