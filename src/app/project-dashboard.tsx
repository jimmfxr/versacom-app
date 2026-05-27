'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useBackgroundRefresh } from '@/hooks/use-background-refresh'
import { SwipeCarousel } from '@/components/swipe-carousel'

/* ─── Types ─── */

type EquipmentForDashboard = {
  category: string
  hardwareType: string | null
  headsetType: string | null
  location: string | null
  deployStatus: string
  assignedToId: number | null
  gooseneck: boolean
  footswitches: number
  speakers: number
}

type UserProject = { id: number; name: string }

type HeadsetInventoryRow = { headsetType: string; brought: number }

type MiscInventory = {
  goosenecksBrought: number
  footswitchesBrought: number
  speakersBrought: number
  quarterXlrmBrought: number
  db9XlrfBrought: number
  rj45XlrmfBrought: number
}

type RadioInventory = {
  total: number
  out: number
  returned: number
  fistMic: { total: number; out: number }
  surveillance: { total: number; out: number }
  doubleMuff: { total: number; out: number }
  lightweight: { total: number; out: number }
}

type ProjectDashboardProps = {
  projectId: number
  equipment: EquipmentForDashboard[]
  headsetInventory: HeadsetInventoryRow[]
  miscInventory: MiscInventory
  /** Aggregated radio + accessory inventory. Renders the Radios
   *  dashboard card with progress bars for total-vs-signed-out. */
  radioInventory: RadioInventory
  canEditInventory: boolean
  /** Project totals for the small stats line rendered on the right
   *  side of the "Deployment status" header on desktop. Hidden on
   *  mobile (the same info already lives in the DashboardHeaderAction
   *  block below the title). */
  memberCount: number
  equipmentCount: number
}

type DashboardHeaderActionProps = {
  projectId: number
  projectName: string
  memberCount: number
  equipmentCount: number
  userProjects: UserProject[]
}

export function DashboardHeaderAction({
  projectId,
  projectName,
  memberCount,
  equipmentCount,
  userProjects,
}: DashboardHeaderActionProps) {
  // memberCount + equipmentCount are no longer rendered here — the
  // stats line moved to the right side of the "Deployment status"
  // section header within ProjectDashboard so they share a row on
  // both mobile and desktop. The props are kept on the type for
  // backwards-compat with the page caller.
  void memberCount
  void equipmentCount
  return (
    <div className="flex w-full flex-col items-start sm:w-auto sm:items-end">
      <ProjectSwitcher projectId={projectId} projectName={projectName} userProjects={userProjects} />
    </div>
  )
}

/* ─── Helpers ─── */

const ASSIGNABLE_CATEGORIES = ['panels', 'wireless_bp', 'hardwire_bp']
const INFRA_CATEGORIES = ['switches', 'antennas', 'audio']

const CATEGORY_GROUP_LABELS: Record<string, string> = {
  panels: 'Panels',
  wireless_bp: 'Wireless beltpacks',
  hardwire_bp: 'Hardwire beltpacks',
  switches: 'Switches',
  antennas: 'Antennas',
  audio: 'Audio I/O',
}

type TypeBreakdown = {
  type: string
  count: number
  total: number
  // Per-deploy-status counts inside the matched (count) subset.
  // Used to draw colored segments inside the row's progress bar.
  deployed: number
  done: number
  returned: number
}

function groupByHardwareType(
  equipment: EquipmentForDashboard[],
  category: string,
  countMatches: (e: EquipmentForDashboard) => boolean,
): TypeBreakdown[] {
  const rows = equipment.filter((e) => e.category === category)
  const byType = new Map<string, { count: number; total: number; deployed: number; done: number; returned: number }>()
  for (const e of rows) {
    const key = e.hardwareType || '(unset)'
    const cur = byType.get(key) ?? { count: 0, total: 0, deployed: 0, done: 0, returned: 0 }
    cur.total += 1
    if (countMatches(e)) {
      cur.count += 1
      if (e.deployStatus === 'deployed') cur.deployed += 1
      else if (e.deployStatus === 'done') cur.done += 1
      else if (e.deployStatus === 'returned') cur.returned += 1
    }
    byType.set(key, cur)
  }
  return Array.from(byType.entries())
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.total - a.total)
}

/* ─── Project switcher ─── */

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`size-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="5 8 10 13 15 8" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="size-3.5 text-white" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 10 8 14 16 6" />
    </svg>
  )
}

export function ProjectSwitcher({
  projectId,
  projectName,
  userProjects,
  basePath = '/',
  showAllOption = false,
  allLabel = 'All shows',
}: {
  /** Currently-selected project id. null = the "All shows" entry is active. */
  projectId: number | null
  /** Label rendered in the trigger button when a project is selected. */
  projectName: string
  userProjects: UserProject[]
  /** Page to navigate to on selection — defaults to dashboard. */
  basePath?: string
  /** Adds a leading "All shows" entry that maps to no project filter. */
  showAllOption?: boolean
  /** Override the "All shows" label. */
  allLabel?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  return (
    <div ref={ref} className="relative w-full sm:inline-block sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2.5 rounded-lg border-2 bg-[#202020] px-3.5 py-2 text-sm font-medium text-white transition-colors sm:min-w-[280px] ${
          open ? 'border-[#0178a3]' : 'border-white/10 hover:border-white/20'
        }`}
      >
        <span>{projectName}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 min-w-[280px] rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl">
          {showAllOption && (() => {
            const isActive = projectId == null
            return (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  if (!isActive) router.push(basePath)
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                  isActive ? 'bg-[#0178a3]' : 'hover:bg-white/[0.06]'
                }`}
              >
                <span className={`text-[13px] font-medium ${isActive ? 'text-white' : 'text-gray-200'}`}>
                  {allLabel}
                </span>
                {isActive && <CheckIcon />}
              </button>
            )
          })()}
          {userProjects.map((p) => {
            const isActive = p.id === projectId
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  if (!isActive) {
                    document.cookie = `selectedProject=${p.id};path=/;max-age=${60 * 60 * 24 * 365}`
                    document.cookie = `selectedProjectName=${encodeURIComponent(p.name)};path=/;max-age=${60 * 60 * 24 * 365}`
                    // basePath supports a `:id` placeholder for routes
                    // where the project lives in the path segment (e.g.
                    // Comms at /projects/<id>). Falls back to the `?project=`
                    // query-param pattern used by Tasks / Notifications /
                    // Dashboard / Radios / etc.
                    if (basePath.includes(':id')) {
                      router.push(basePath.replace(':id', String(p.id)))
                    } else {
                      const sep = basePath.includes('?') ? '&' : '?'
                      router.push(`${basePath}${sep}project=${p.id}`)
                    }
                  }
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                  isActive ? 'bg-[#0178a3]' : 'hover:bg-white/[0.06]'
                }`}
              >
                <span className={`text-[13px] font-medium ${isActive ? 'text-white' : 'text-gray-200'}`}>
                  {p.name}
                </span>
                {isActive && <CheckIcon />}
              </button>
            )
          })}
          <div className="my-1 h-px bg-white/[0.06]" />
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              router.push('/projects')
            }}
            className="block w-full rounded-md px-3 py-2 text-left text-xs text-gray-400 hover:bg-white/[0.06] hover:text-white"
          >
            All projects →
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── Bar chart row ─── */

function BarRow({
  label,
  count,
  total,
  tagOverride,
  deployed = 0,
  done = 0,
  returned = 0,
}: {
  label: string
  count: number
  total: number
  tagOverride?: string
  /** Per-deploy-status counts inside `count`. Drawn as colored segments. */
  deployed?: number
  done?: number
  returned?: number
}) {
  const safeTotal = total > 0 ? total : 1
  const deployedPct = (deployed / safeTotal) * 100
  const donePct = (done / safeTotal) * 100
  const returnedPct = (returned / safeTotal) * 100
  // Anything counted but without a known status shows as a neutral cyan
  // segment so we never lose information.
  const otherCount = Math.max(0, count - deployed - done - returned)
  const otherPct = (otherCount / safeTotal) * 100

  return (
    <div className="mb-3 grid grid-cols-[110px_1fr_auto] items-center gap-3 last:mb-0 sm:grid-cols-[120px_1fr_auto] sm:gap-3.5">
      <div className="truncate text-[11px] font-medium text-gray-300 sm:text-xs">{label}</div>
      <div className="flex h-[18px] overflow-hidden rounded-md bg-white/[0.05]">
        <div className="h-full bg-yellow-500/80" style={{ width: `${deployedPct}%` }} />
        <div className="h-full bg-green-500/80" style={{ width: `${donePct}%` }} />
        <div className="h-full bg-blue-500/80" style={{ width: `${returnedPct}%` }} />
        <div className="h-full bg-white/[0.18]" style={{ width: `${otherPct}%` }} />
      </div>
      <div className="min-w-[60px] text-right font-mono text-[10px] tabular-nums text-gray-400 sm:min-w-[80px] sm:text-[11px]">
        {tagOverride ? (
          <span className="font-semibold text-white">{tagOverride}</span>
        ) : (
          <>
            <span className="font-semibold text-white">{count}</span> / {total}
          </>
        )}
      </div>
    </div>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 border-b border-white/[0.05] pb-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">
      {children}
    </div>
  )
}

/** Collapsible variant — same look as GroupLabel but the header is a button
 *  that toggles a section's visibility. */
function CollapsibleLabel({
  children,
  collapsed,
  onToggle,
}: {
  children: React.ReactNode
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-3 flex w-full items-center justify-between border-b border-white/[0.05] pb-1.5 text-left text-[9px] font-bold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-300"
      aria-expanded={!collapsed}
    >
      <span>{children}</span>
      <svg
        className={`size-3 text-gray-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.5}
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      </svg>
    </button>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="py-5 text-center text-xs text-gray-500">{children}</div>
}

function CardHeader({ title, subtitle, tag }: { title: string; subtitle?: string; tag?: string }) {
  return (
    <div className="mb-1 flex items-start justify-between">
      <div>
        <div className="text-base font-semibold text-white">{title}</div>
        {subtitle && <div className="mt-0.5 text-[11px] text-gray-500">{subtitle}</div>}
      </div>
      {tag && (
        <span className="inline-block rounded-full bg-[#22a7d3]/15 px-2.5 py-1 text-xs font-semibold text-[#22a7d3]">
          {tag}
        </span>
      )}
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 mt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
      {children}
    </div>
  )
}

/* ─── Status hero card (Done / Returned) ─── */

function StatusStat({
  dotClass,
  pctClass,
  label,
  count,
  total,
}: {
  dotClass: string
  pctClass: string
  label: string
  count: number
  total: number
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className={`size-2 shrink-0 rounded-full ${dotClass}`} />
        <span className="truncate font-semibold uppercase tracking-wider text-gray-400 text-[10px]">
          {label}
        </span>
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-white">
        {count} <span className="text-gray-500">/ {total}</span>
      </div>
      <div className={`text-[11px] font-semibold tabular-nums ${pctClass}`}>{pct}%</div>
    </div>
  )
}

function StatusHero({
  count,
  total,
  label,
  sublabel,
  color,
  detail,
}: {
  count: number
  total: number
  label: string
  sublabel: string
  color: 'cyan' | 'purple'
  detail: string
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  const colorClass = color === 'cyan' ? 'text-[#22a7d3]' : 'text-[#c084fc]'
  const fillClass = color === 'cyan' ? 'bg-[#22a7d3]/70' : 'bg-[#c084fc]/70'
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5 sm:px-6">
      <div className="flex items-baseline gap-2 sm:block">
        <div className={`text-[32px] font-bold leading-none tabular-nums sm:text-[38px] ${colorClass}`}>
          {pct}%
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 sm:hidden">
          {label}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 hidden text-[10px] font-semibold uppercase tracking-wider text-gray-400 sm:block">
          {label}
        </div>
        <div className="text-[11px] text-gray-300 sm:text-xs">{sublabel}</div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div className={`h-full rounded-full ${fillClass}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 text-[10px] text-gray-500 sm:text-[11px]">{detail}</div>
      </div>
    </div>
  )
}

/* ─── Main component ─── */

export function ProjectDashboard({ projectId, equipment, headsetInventory, miscInventory, radioInventory, canEditInventory, memberCount, equipmentCount }: ProjectDashboardProps) {
  // Inventory editing was removed from the dashboard — it now lives under
  // the project's Equipment tab (Add Equipment card → Inventory tab). The
  // canEditInventory prop and projectId are retained on the props type for
  // backwards compatibility with the server caller and a possible future
  // "edit inventory" link from this card.
  void canEditInventory
  void projectId
  // Auto-refresh deployment counts as crew check off gear from My
  // Equipment / Tasks / project pages. No editing state to pause for —
  // dashboard is read-only.
  useBackgroundRefresh()
  const [headsetsCollapsed, setHeadsetsCollapsed] = useState(false)
  const [miscCollapsed, setMiscCollapsed] = useState(false)
  /* Deployment status — gear that's actually expected to deploy */
  const deployEligible = equipment.filter((e) => {
    if (e.category === 'wireless_bp') return false // wireless excluded
    if (e.deployStatus === 'not-needed') return false // inventory only, not deployment
    if (e.deployStatus === 'damaged') return false // damaged is its own state
    if (ASSIGNABLE_CATEGORIES.includes(e.category) && !e.assignedToId) return false // unassigned panels/hardwire
    if (['switches', 'antennas'].includes(e.category) && (!e.location || !e.location.trim())) return false // switches/antennas without a location
    return true
  })
  const deployTotal = deployEligible.length
  const deployedCount = deployEligible.filter((e) => e.deployStatus === 'deployed').length
  const doneCount = deployEligible.filter((e) => e.deployStatus === 'done').length
  const returnedCount = deployEligible.filter((e) => e.deployStatus === 'returned').length
  const donePct = deployTotal > 0 ? Math.round((doneCount / deployTotal) * 100) : 0
  const deployedPct = deployTotal > 0 ? Math.round((deployedCount / deployTotal) * 100) : 0
  const returnedPct = deployTotal > 0 ? Math.round((returnedCount / deployTotal) * 100) : 0

  // Headline = whichever stage currently leads. Ties break: done > deployed > returned (most actionable).
  const headlineStat = (() => {
    const stats = [
      { key: 'done', pct: donePct, label: 'Faxed', color: 'text-green-500/80' },
      { key: 'deployed', pct: deployedPct, label: 'Deployed', color: 'text-yellow-500/80' },
      { key: 'returned', pct: returnedPct, label: 'Returned', color: 'text-blue-500/80' },
    ]
    return stats.reduce((best, s) => (s.pct > best.pct ? s : best), stats[0])
  })()

  /* Assignment by hardware type */
  const assignmentGroups = ASSIGNABLE_CATEGORIES.map((cat) => ({
    cat,
    label: CATEGORY_GROUP_LABELS[cat],
    rows: groupByHardwareType(equipment, cat, (e) => e.assignedToId != null),
  }))
  const assignmentCount = assignmentGroups.reduce(
    (acc, g) => acc + g.rows.reduce((s, r) => s + r.count, 0),
    0,
  )
  const assignmentTotal = assignmentGroups.reduce(
    (acc, g) => acc + g.rows.reduce((s, r) => s + r.total, 0),
    0,
  )

  /* Utilization by hardware type */
  const utilizationGroups = INFRA_CATEGORIES.map((cat) => ({
    cat,
    label: CATEGORY_GROUP_LABELS[cat],
    rows: groupByHardwareType(equipment, cat, (e) => !!(e.location && e.location.trim())),
  }))
  const utilizationCount = utilizationGroups.reduce(
    (acc, g) => acc + g.rows.reduce((s, r) => s + r.count, 0),
    0,
  )
  const utilizationTotal = utilizationGroups.reduce(
    (acc, g) => acc + g.rows.reduce((s, r) => s + r.total, 0),
    0,
  )

  /* Headsets — derived demand (needed + assigned), merged with packed inventory (brought)
     If an admin hasn't explicitly recorded inventory for a type, we assume the
     packed count equals the needed count (you wouldn't assign equipment to a
     beltpack without packing its headset). The admin only edits to record
     spares or shortages on top. */
  const headsetMap = (() => {
    const m = new Map<string, { needed: number; assigned: number; brought: number; tracked: boolean; deployed: number; done: number; returned: number }>()
    for (const e of equipment) {
      if (!e.headsetType || !e.headsetType.trim()) continue
      const key = e.headsetType.trim()
      const cur = m.get(key) ?? { needed: 0, assigned: 0, brought: 0, tracked: false, deployed: 0, done: 0, returned: 0 }
      cur.needed += 1
      if (e.assignedToId != null) {
        cur.assigned += 1
        if (e.deployStatus === 'deployed') cur.deployed += 1
        else if (e.deployStatus === 'done') cur.done += 1
        else if (e.deployStatus === 'returned') cur.returned += 1
      }
      m.set(key, cur)
    }
    for (const inv of headsetInventory) {
      const cur = m.get(inv.headsetType) ?? { needed: 0, assigned: 0, brought: 0, tracked: false, deployed: 0, done: 0, returned: 0 }
      cur.brought = inv.brought
      cur.tracked = true
      m.set(inv.headsetType, cur)
    }
    // Resolve "effective brought" — implicit = needed when not tracked.
    const rows = Array.from(m.entries()).map(([type, v]) => {
      const effectiveBrought = v.tracked ? v.brought : v.needed
      return {
        type,
        needed: v.needed,
        assigned: v.assigned,
        brought: effectiveBrought,
        tracked: v.tracked,
        deployed: v.deployed,
        done: v.done,
        returned: v.returned,
      }
    })
    return rows
  })()
  const headsetRows = headsetMap.sort((a, b) => Math.max(b.brought, b.needed) - Math.max(a.brought, a.needed))

  const headsetNeededByType: Record<string, number> = {}
  for (const r of headsetRows) headsetNeededByType[r.type] = r.needed

  const headsetsAssigned = headsetRows.reduce((s, r) => s + r.assigned, 0)
  // r.brought already includes the implicit "packed = needed" fallback when not tracked.
  const headsetsBrought = headsetRows.reduce((s, r) => s + r.brought, 0)
  const headsetsNeeded = headsetRows.reduce((s, r) => s + r.needed, 0)

  /* Panel-only Misc accessories — needed/brought, mirrors headset behavior.
     "Needed" = sum of demand from panels (e.g. all gooseneck=true panels,
     sum of footswitches values, sum of speakers values).
     "Brought" = manager-set total in miscInventory; falls back to needed
     when 0 ("not tracked"). */
  const allPanels = equipment.filter((e) => e.category === 'panels')
  const goosenecksNeeded = allPanels.filter((e) => e.gooseneck).length
  const footswitchesNeeded = allPanels.reduce((s, e) => s + (e.footswitches || 0), 0)
  const speakersNeeded = allPanels.reduce((s, e) => s + (e.speakers || 0), 0)
  // Cable accessories derived from panel config:
  //   1/4-XLRM = 1 per footswitch                     → same as footswitchesNeeded
  //   DB9-XLRF = 1 per panel that has any footswitches
  //   RJ45-XLRMF = 1 per speaker                       → same as speakersNeeded
  const quarterXlrmNeeded = footswitchesNeeded
  const db9XlrfNeeded = allPanels.filter((e) => (e.footswitches || 0) > 0).length
  const rj45XlrmfNeeded = speakersNeeded

  const goosenecksTracked = miscInventory.goosenecksBrought > 0
  const footswitchesTracked = miscInventory.footswitchesBrought > 0
  const speakersTracked = miscInventory.speakersBrought > 0
  const quarterXlrmTracked = miscInventory.quarterXlrmBrought > 0
  const db9XlrfTracked = miscInventory.db9XlrfBrought > 0
  const rj45XlrmfTracked = miscInventory.rj45XlrmfBrought > 0

  // Per-accessory deployed/done/returned breakdown so the misc BarRow
  // overlays match the colored stack on the headset rows. We follow each
  // accessory's per-panel rule (1 per gooseneck flag, sum of footswitches,
  // 1 per panel-with-footswitches, etc.) and bucket by the host panel's
  // deployStatus.
  const miscByStatus = (() => {
    const init = () => ({ deployed: 0, done: 0, returned: 0 })
    const goosenecks = init()
    const footswitches = init()
    const speakers = init()
    const quarterXlrm = init()
    const db9Xlrf = init()
    const rj45Xlrmf = init()
    for (const e of allPanels) {
      const bucket =
        e.deployStatus === 'deployed' ? 'deployed' :
        e.deployStatus === 'done' ? 'done' :
        e.deployStatus === 'returned' ? 'returned' : null
      if (!bucket) continue
      if (e.gooseneck) goosenecks[bucket] += 1
      const fs = e.footswitches || 0
      if (fs > 0) {
        footswitches[bucket] += fs
        quarterXlrm[bucket] += fs   // 1 per footswitch
        db9Xlrf[bucket] += 1        // 1 per panel with footswitches
      }
      const sp = e.speakers || 0
      if (sp > 0) {
        speakers[bucket] += sp
        rj45Xlrmf[bucket] += sp     // 1 per speaker
      }
    }
    return { goosenecks, footswitches, speakers, quarterXlrm, db9Xlrf, rj45Xlrmf }
  })()
  const goosenecksBrought = goosenecksTracked ? miscInventory.goosenecksBrought : goosenecksNeeded
  const footswitchesBrought = footswitchesTracked ? miscInventory.footswitchesBrought : footswitchesNeeded
  const speakersBrought = speakersTracked ? miscInventory.speakersBrought : speakersNeeded
  const quarterXlrmBrought = quarterXlrmTracked ? miscInventory.quarterXlrmBrought : quarterXlrmNeeded
  const db9XlrfBrought = db9XlrfTracked ? miscInventory.db9XlrfBrought : db9XlrfNeeded
  const rj45XlrmfBrought = rj45XlrmfTracked ? miscInventory.rj45XlrmfBrought : rj45XlrmfNeeded
  const hasAnyMisc =
    goosenecksNeeded + footswitchesNeeded + speakersNeeded + quarterXlrmNeeded + db9XlrfNeeded + rj45XlrmfNeeded > 0
    || goosenecksTracked || footswitchesTracked || speakersTracked
    || quarterXlrmTracked || db9XlrfTracked || rj45XlrmfTracked

  return (
    // Dashboard root locks the whole tree to vertical pans by default.
    // The SwipeCarousel inside re-enables horizontal pans on its own
    // track only — so a horizontal/diagonal gesture on the deployment
    // status card or section headers can't leak out and get picked up
    // by the carousel's overflow-x scroller below. Also pb-6 gives the
    // last children (carousel dots) room to breathe above the
    // safe-area inset on iPhones.
    <div
      className="divide-y divide-white/[0.06] [&>div]:py-3 sm:[&>div]:py-4 pb-6"
      style={{ touchAction: 'pan-y' }}
    >
      {/* Deployment status — single combined card.
          touch-action: pan-y on the OUTER div (not just the inner
          padded one) so a touch starting anywhere on this card —
          including the SectionHeader — is locked to vertical scroll
          and can't be hijacked by the carousel further down. */}
      {/* paddingBottom: 0 (inline) overrides the parent's
          [&>div]:py-3 / sm:[&>div]:py-4 so this section doesn't carry
          the 12px (mobile) / 16px (desktop) bottom padding — section
          ends flush at the divider. Tailwind's !pb-0 wasn't winning
          against the arbitrary-variant parent rule consistently, so
          inline style is the reliable override. The inner pt-4 sm:pt-5
          provides top breathing room only. */}
      <div
        style={{
          borderBottomWidth: 0,
          touchAction: 'pan-y',
          paddingBottom: 0,
        }}
      >
        {/* Inline header so the right side can carry the project
            stats (members / equipment counts). Renders on both mobile
            and desktop now — the duplicate stats line under the title
            in DashboardHeaderAction was removed alongside this change. */}
        <div className="mb-2.5 mt-2 flex items-baseline justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Comms
          </div>
          <div className="text-xs text-gray-500">
            {memberCount} {memberCount === 1 ? 'member' : 'members'} · {equipmentCount}{' '}
            {equipmentCount === 1 ? 'equipment item' : 'equipment items'}
          </div>
        </div>
        <div className="pt-4 sm:pt-5">
          {/* Always row: pct on the left, progress bar on the right.
              Pct + label always stacked vertically (label sits
              directly under the percentage on every breakpoint). */}
          <div className="flex flex-row items-center gap-4 sm:gap-6">
            {/* Headline % — the stage currently leading. Label sits
                ABOVE the percentage so the small uppercase status reads
                first, then the big number. */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {headlineStat.label}
              </div>
              <div className={`text-[36px] font-bold leading-none tabular-nums sm:text-[42px] ${headlineStat.color}`}>
                {headlineStat.pct}%
              </div>
            </div>

            {/* Stacked-segment lifecycle bar */}
            <div className="min-w-0 flex-1">
              <div className="flex h-[18px] w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full bg-yellow-500/80"
                  style={{ width: `${deployedPct}%` }}
                  title={`${deployedCount} deployed`}
                />
                <div
                  className="h-full bg-green-500/80"
                  style={{ width: `${donePct}%` }}
                  title={`${doneCount} done`}
                />
                <div
                  className="h-full bg-blue-500/80"
                  style={{ width: `${returnedPct}%` }}
                  title={`${returnedCount} returned`}
                />
              </div>

              {/* Mini stats row */}
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] sm:text-xs">
                <StatusStat dotClass="bg-yellow-500/80" pctClass="text-yellow-500/80" label="Deployed" count={deployedCount} total={deployTotal} />
                <StatusStat dotClass="bg-green-500/80" pctClass="text-green-500/80" label="Faxed" count={doneCount} total={deployTotal} />
                <StatusStat dotClass="bg-blue-500/80" pctClass="text-blue-500/80" label="Returned" count={returnedCount} total={deployTotal} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Distribution + Headsets — three cards: carousel on mobile, 3-col grid on desktop */}
      <div>
        <SectionHeader>Distribution</SectionHeader>
        {(() => {
          const cardClass =
            'flex h-full flex-col rounded-lg border border-white/10 p-4 sm:p-5'

          const assignmentCard = (
            <div className={cardClass}>
              <CardHeader
                title="Assigned to a user"
                tag={`${assignmentCount} / ${assignmentTotal}`}
              />
              {assignmentTotal === 0 ? (
                <EmptyRow>No assignable equipment yet</EmptyRow>
              ) : (
                assignmentGroups.map((g) => (
                  <div key={g.cat} className="mt-6 first:mt-0">
                    <GroupLabel>{g.label}</GroupLabel>
                    {g.rows.length === 0 ? (
                      <EmptyRow>No {g.label.toLowerCase()} in this project</EmptyRow>
                    ) : (
                      g.rows.map((r) => (
                        <BarRow key={r.type} label={r.type} count={r.count} total={r.total} deployed={r.deployed} done={r.done} returned={r.returned} />
                      ))
                    )}
                  </div>
                ))
              )}
            </div>
          )

          const utilizationCard = (
            <div className={cardClass}>
              <CardHeader
                title="In use on the show"
                tag={`${utilizationCount} / ${utilizationTotal}`}
              />
              {utilizationTotal === 0 ? (
                <EmptyRow>No infrastructure equipment yet</EmptyRow>
              ) : (
                utilizationGroups.map((g) => (
                  <div key={g.cat} className="mt-6 first:mt-0">
                    <GroupLabel>{g.label}</GroupLabel>
                    {g.rows.length === 0 ? (
                      <EmptyRow>No {g.label.toLowerCase()} equipment in this project</EmptyRow>
                    ) : (
                      g.rows.map((r) => (
                        <BarRow key={r.type} label={r.type} count={r.count} total={r.total} deployed={r.deployed} done={r.done} returned={r.returned} />
                      ))
                    )}
                  </div>
                ))
              )}
            </div>
          )

          const headsetsDisplay = (
            <>
              <CardHeader
                title={hasAnyMisc ? 'Headsets / Misc' : 'Headsets assigned'}
                tag={headsetsBrought > 0 ? `${headsetsAssigned} / ${headsetsBrought}` : undefined}
              />
              {headsetRows.length === 0 && !hasAnyMisc ? (
                <EmptyRow>
                  {canEditInventory
                    ? 'No headsets tracked yet. Open Equipment → Inventory to record what you packed.'
                    : 'No headsets assigned to any equipment in this project'}
                </EmptyRow>
              ) : (
                <>
                  {headsetRows.length > 0 && (
                    <div className="mt-6">
                      <CollapsibleLabel
                        collapsed={headsetsCollapsed}
                        onToggle={() => setHeadsetsCollapsed((v) => !v)}
                      >
                        Headsets · {headsetRows.length} {headsetRows.length === 1 ? 'type' : 'types'}
                      </CollapsibleLabel>
                      {!headsetsCollapsed && headsetRows.map((r) => (
                        <BarRow
                          key={r.type}
                          label={r.type}
                          count={r.assigned}
                          total={Math.max(r.brought, 1)}
                          tagOverride={`${r.assigned} / ${r.brought}`}
                          deployed={r.deployed}
                          done={r.done}
                          returned={r.returned}
                        />
                      ))}
                    </div>
                  )}
                  {hasAnyMisc && (
                    <div className="mt-6">
                      <CollapsibleLabel
                        collapsed={miscCollapsed}
                        onToggle={() => setMiscCollapsed((v) => !v)}
                      >
                        Misc
                      </CollapsibleLabel>
                      {!miscCollapsed && (
                        <>
                          {(goosenecksNeeded > 0 || goosenecksTracked) && (
                            <BarRow
                              label="Goosenecks"
                              count={goosenecksNeeded}
                              total={Math.max(goosenecksBrought, 1)}
                              tagOverride={`${goosenecksNeeded} / ${goosenecksBrought}`}
                              deployed={miscByStatus.goosenecks.deployed}
                              done={miscByStatus.goosenecks.done}
                              returned={miscByStatus.goosenecks.returned}
                            />
                          )}
                          {(footswitchesNeeded > 0 || footswitchesTracked) && (
                            <BarRow
                              label="Footswitches"
                              count={footswitchesNeeded}
                              total={Math.max(footswitchesBrought, 1)}
                              tagOverride={`${footswitchesNeeded} / ${footswitchesBrought}`}
                              deployed={miscByStatus.footswitches.deployed}
                              done={miscByStatus.footswitches.done}
                              returned={miscByStatus.footswitches.returned}
                            />
                          )}
                          {(speakersNeeded > 0 || speakersTracked) && (
                            <BarRow
                              label="Speakers"
                              count={speakersNeeded}
                              total={Math.max(speakersBrought, 1)}
                              tagOverride={`${speakersNeeded} / ${speakersBrought}`}
                              deployed={miscByStatus.speakers.deployed}
                              done={miscByStatus.speakers.done}
                              returned={miscByStatus.speakers.returned}
                            />
                          )}
                          {(quarterXlrmNeeded > 0 || quarterXlrmTracked) && (
                            <BarRow
                              label="1/4-XLRM"
                              count={quarterXlrmNeeded}
                              total={Math.max(quarterXlrmBrought, 1)}
                              tagOverride={`${quarterXlrmNeeded} / ${quarterXlrmBrought}`}
                              deployed={miscByStatus.quarterXlrm.deployed}
                              done={miscByStatus.quarterXlrm.done}
                              returned={miscByStatus.quarterXlrm.returned}
                            />
                          )}
                          {(db9XlrfNeeded > 0 || db9XlrfTracked) && (
                            <BarRow
                              label="DB9-XLRF"
                              count={db9XlrfNeeded}
                              total={Math.max(db9XlrfBrought, 1)}
                              tagOverride={`${db9XlrfNeeded} / ${db9XlrfBrought}`}
                              deployed={miscByStatus.db9Xlrf.deployed}
                              done={miscByStatus.db9Xlrf.done}
                              returned={miscByStatus.db9Xlrf.returned}
                            />
                          )}
                          {(rj45XlrmfNeeded > 0 || rj45XlrmfTracked) && (
                            <BarRow
                              label="RJ45-XLRMF"
                              count={rj45XlrmfNeeded}
                              total={Math.max(rj45XlrmfBrought, 1)}
                              tagOverride={`${rj45XlrmfNeeded} / ${rj45XlrmfBrought}`}
                              deployed={miscByStatus.rj45Xlrmf.deployed}
                              done={miscByStatus.rj45Xlrmf.done}
                              returned={miscByStatus.rj45Xlrmf.returned}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
              {/* Edit button + inline inventory editor moved to the
                  project's Equipment tab (Add Equipment card → Inventory
                  tab). The dashboard card stays read-only. */}
            </>
          )

          // Build the headsets card. Now read-only on the dashboard — the
          // editor lives under the project's Equipment tab.
          const buildHeadsetsCard = () => (
            <div className={`${cardClass} relative`}>
              {headsetsDisplay}
            </div>
          )

          return (
            <>
              {/* Mobile: swipeable carousel (left/right swipe with
                  Instagram-style dot indicators). Only the carousel
                  itself scrolls horizontally — the rest of the page
                  stacks vertically. */}
              <SwipeCarousel>
                {assignmentCard}
                {utilizationCard}
                {buildHeadsetsCard()}
              </SwipeCarousel>
              {/* Desktop: 3-column grid, all cards equal height. */}
              <div className="hidden items-stretch gap-4 sm:grid sm:grid-cols-3">
                {assignmentCard}
                {utilizationCard}
                {buildHeadsetsCard()}
              </div>
            </>
          )
        })()}
      </div>

      {/* ─── Radios ──────────────────────────────────────────────
          Hero + inventory card are bundled under ONE wrapper so the
          parent's divide-y doesn't draw a line BETWEEN them — they
          read as a single radio section. */}
      {(() => {
        const rTotal = radioInventory.total
        const rOut = radioInventory.out
        const rReturned = radioInventory.returned
        const outPct = rTotal > 0 ? Math.round((rOut / rTotal) * 100) : 0
        const returnedPct = rTotal > 0 ? Math.round((rReturned / rTotal) * 100) : 0
        // Headline = whichever stage leads. Tie-break: out > returned
        // (out is the more actionable state for show ops).
        const radioStats = [
          { key: 'out', pct: outPct, label: 'Out', color: 'text-yellow-500/80' },
          { key: 'returned', pct: returnedPct, label: 'Returned', color: 'text-blue-500/80' },
        ]
        const radioHeadline = radioStats.reduce((best, s) => (s.pct > best.pct ? s : best), radioStats[0])
        return (
          <div style={{ touchAction: 'pan-y' }}>
            <div className="mb-2.5 mt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Radios
            </div>
            <div className="pt-2 sm:pt-3">
              <div className="flex flex-row items-center gap-4 sm:gap-6">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {radioHeadline.label}
                  </div>
                  <div className={`text-[36px] font-bold leading-none tabular-nums sm:text-[42px] ${radioHeadline.color}`}>
                    {radioHeadline.pct}%
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex h-[18px] w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full bg-yellow-500/80"
                      style={{ width: `${outPct}%` }}
                      title={`${rOut} out`}
                    />
                    <div
                      className="h-full bg-blue-500/80"
                      style={{ width: `${returnedPct}%` }}
                      title={`${rReturned} returned`}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:text-xs">
                    <StatusStat dotClass="bg-yellow-500/80" pctClass="text-yellow-500/80" label="Out" count={rOut} total={rTotal} />
                    <StatusStat dotClass="bg-blue-500/80" pctClass="text-blue-500/80" label="Returned" count={rReturned} total={rTotal} />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <SectionHeader>Radio inventory</SectionHeader>
              <div className="flex flex-col rounded-lg border border-white/10 p-4 sm:p-5">
                <CardHeader
                  title="Signed out"
                  tag={`${radioInventory.out} / ${radioInventory.total}`}
                />
                {radioInventory.total === 0 ? (
                  <EmptyRow>No radios in this project yet</EmptyRow>
                ) : (
                  <div className="mt-4">
                    <BarRow
                      label="Radios"
                      count={radioInventory.out}
                      total={radioInventory.total}
                      deployed={radioInventory.out}
                    />
                    <BarRow
                      label="Fist mics"
                      count={radioInventory.fistMic.out}
                      total={radioInventory.fistMic.total}
                      deployed={radioInventory.fistMic.out}
                    />
                    <BarRow
                      label="Surveillance"
                      count={radioInventory.surveillance.out}
                      total={radioInventory.surveillance.total}
                      deployed={radioInventory.surveillance.out}
                    />
                    <BarRow
                      label="Double"
                      count={radioInventory.doubleMuff.out}
                      total={radioInventory.doubleMuff.total}
                      deployed={radioInventory.doubleMuff.out}
                    />
                    <BarRow
                      label="LWHS"
                      count={radioInventory.lightweight.out}
                      total={radioInventory.lightweight.total}
                      deployed={radioInventory.lightweight.out}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
