'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { HeadsetInventoryEditor } from '@/components/headset-inventory-editor'
import { SwipeCarousel } from '@/components/swipe-carousel'

/* ─── Types ─── */

type EquipmentForDashboard = {
  category: string
  hardwareType: string | null
  headsetType: string | null
  location: string | null
  deployStatus: string
  assignedToId: number | null
}

type UserProject = { id: number; name: string }

type HeadsetInventoryRow = { headsetType: string; brought: number }

type ProjectDashboardProps = {
  projectId: number
  equipment: EquipmentForDashboard[]
  headsetInventory: HeadsetInventoryRow[]
  canEditInventory: boolean
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
  return (
    <div className="flex w-full flex-col items-start sm:w-auto sm:items-end">
      <ProjectSwitcher projectId={projectId} projectName={projectName} userProjects={userProjects} />
      <div className="mt-2 text-xs text-gray-500">
        {memberCount} {memberCount === 1 ? 'member' : 'members'} · {equipmentCount}{' '}
        {equipmentCount === 1 ? 'equipment item' : 'equipment items'}
      </div>
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
    <svg className="size-3.5 text-[#22a7d3]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 10 8 14 16 6" />
    </svg>
  )
}

export function ProjectSwitcher({
  projectId,
  projectName,
  userProjects,
}: {
  projectId: number
  projectName: string
  userProjects: UserProject[]
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
        className={`flex w-full items-center justify-between gap-2.5 rounded-lg border px-3.5 py-2 text-sm font-medium text-gray-200 transition-colors sm:min-w-[280px] ${
          open
            ? 'border-[#22a7d3]/50 bg-white/[0.04]'
            : 'border-white/10 hover:border-white/20 hover:bg-white/[0.04]'
        }`}
      >
        <span>{projectName}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 min-w-[280px] rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl">
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
                    router.push(`/?project=${p.id}`)
                  }
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                  isActive ? 'bg-[#22a7d3]/10' : 'hover:bg-white/[0.06]'
                }`}
              >
                <span className={`text-[13px] font-medium ${isActive ? 'text-[#22a7d3]' : 'text-gray-200'}`}>
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
        <div className="h-full bg-yellow-400" style={{ width: `${deployedPct}%` }} />
        <div className="h-full bg-green-400" style={{ width: `${donePct}%` }} />
        <div className="h-full bg-blue-400" style={{ width: `${returnedPct}%` }} />
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
  const fillClass = color === 'cyan' ? 'bg-[#22a7d3]' : 'bg-[#c084fc]'
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-[#2a2a2a] p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5 sm:px-6">
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

export function ProjectDashboard({ projectId, equipment, headsetInventory, canEditInventory }: ProjectDashboardProps) {
  const [editingInventory, setEditingInventory] = useState(false)
  const editorMobileRef = useRef<HTMLDivElement>(null)
  const editorDesktopRef = useRef<HTMLDivElement>(null)
  const savedScrollY = useRef<number | null>(null)

  // When entering edit mode, remember where we were and scroll the editor into
  // view. The headsets card is rendered twice (mobile carousel + desktop grid);
  // we measure whichever copy is currently visible, then scroll the page so the
  // editor's bottom (Save/Cancel buttons) lands in view. On exit, restore.
  useEffect(() => {
    if (editingInventory) {
      savedScrollY.current = window.scrollY
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Pick whichever copy actually has dimensions (the visible one).
          const candidates = [editorDesktopRef.current, editorMobileRef.current]
          const editor = candidates.find((el) => el && el.getBoundingClientRect().height > 0)
          if (!editor) return
          const rect = editor.getBoundingClientRect()
          const editorBottom = rect.bottom + window.scrollY
          const viewportBottom = window.scrollY + window.innerHeight
          if (editorBottom > viewportBottom) {
            window.scrollTo({
              top: editorBottom - window.innerHeight + 24,
              behavior: 'smooth',
            })
          }
        })
      })
    } else if (savedScrollY.current != null) {
      window.scrollTo({ top: savedScrollY.current, behavior: 'smooth' })
      savedScrollY.current = null
    }
  }, [editingInventory])
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
      { key: 'done', pct: donePct, label: 'Done', color: 'text-green-400' },
      { key: 'deployed', pct: deployedPct, label: 'Deployed', color: 'text-yellow-400' },
      { key: 'returned', pct: returnedPct, label: 'Returned', color: 'text-blue-400' },
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

  return (
    <div className="space-y-5">
      {/* Deployment status — single combined card */}
      <div>
        <SectionHeader>Deployment status</SectionHeader>
        <div className="rounded-2xl bg-[#2a2a2a] p-4 sm:p-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
            {/* Headline % — the stage currently leading */}
            <div className="flex items-baseline gap-2 sm:block">
              <div className={`text-[36px] font-bold leading-none tabular-nums sm:text-[42px] ${headlineStat.color}`}>
                {headlineStat.pct}%
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {headlineStat.label}
              </div>
            </div>

            {/* Stacked-segment lifecycle bar */}
            <div className="min-w-0 flex-1">
              <div className="flex h-[18px] w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full bg-yellow-400"
                  style={{ width: `${deployedPct}%` }}
                  title={`${deployedCount} deployed`}
                />
                <div
                  className="h-full bg-green-400"
                  style={{ width: `${donePct}%` }}
                  title={`${doneCount} done`}
                />
                <div
                  className="h-full bg-blue-400"
                  style={{ width: `${returnedPct}%` }}
                  title={`${returnedCount} returned`}
                />
              </div>

              {/* Mini stats row */}
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] sm:text-xs">
                <StatusStat dotClass="bg-yellow-400" pctClass="text-yellow-400" label="Deployed" count={deployedCount} total={deployTotal} />
                <StatusStat dotClass="bg-green-400" pctClass="text-green-400" label="Done" count={doneCount} total={deployTotal} />
                <StatusStat dotClass="bg-blue-400" pctClass="text-blue-400" label="Returned" count={returnedCount} total={deployTotal} />
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
            'flex h-full flex-col rounded-2xl bg-[#2a2a2a] p-4 sm:p-5'

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
                title="Headsets assigned"
                tag={headsetsBrought > 0 ? `${headsetsAssigned} / ${headsetsBrought}` : undefined}
              />
              {headsetRows.length === 0 ? (
                <EmptyRow>
                  {canEditInventory
                    ? 'No headsets tracked yet. Tap "Manage" to record what you packed.'
                    : 'No headsets assigned to any equipment in this project'}
                </EmptyRow>
              ) : (
                <div className="mt-6">
                  <GroupLabel>All Types</GroupLabel>
                  {headsetRows.map((r) => (
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
              {canEditInventory && (
                <div className="mt-auto flex justify-end pt-4">
                  <button
                    type="button"
                    onClick={() => setEditingInventory(true)}
                    className="rounded-md bg-[#0178a3] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#019bc7]"
                  >
                    {headsetsBrought > 0 ? 'Edit' : 'Manage'}
                  </button>
                </div>
              )}
            </>
          )

          // Build the headsets card. Same JSX, but attaches a different editor
          // ref depending on which copy this is (mobile carousel vs desktop grid)
          // so the auto-scroll effect can find the visible one.
          const buildHeadsetsCard = (editorRef: React.RefObject<HTMLDivElement | null>) => (
            <div className={`${cardClass} relative`}>
              {editingInventory && canEditInventory ? (
                <>
                  {/* Display "ghost" — invisible on desktop, hidden on mobile */}
                  <div className="invisible hidden sm:block" aria-hidden="true">
                    {headsetsDisplay}
                  </div>
                  {/* Editor: inline on mobile, absolute overlay on desktop */}
                  <div ref={editorRef} className="sm:absolute sm:inset-x-0 sm:top-0 sm:z-10 sm:min-h-full sm:rounded-2xl sm:bg-[#2a2a2a] sm:p-5 sm:shadow-2xl sm:shadow-black/50">
                    <HeadsetInventoryEditor
                      projectId={projectId}
                      initial={headsetInventory}
                      needed={headsetNeededByType}
                      onDone={() => setEditingInventory(false)}
                    />
                  </div>
                </>
              ) : (
                headsetsDisplay
              )}
            </div>
          )

          return (
            <>
              {/* Mobile: swipeable carousel */}
              <SwipeCarousel>
                {assignmentCard}
                {utilizationCard}
                {buildHeadsetsCard(editorMobileRef)}
              </SwipeCarousel>
              {/* Desktop: 3-column grid, all cards equal height. The headsets
                  editor renders absolutely so it can grow downward beyond the
                  row without stretching the other two cards. */}
              <div className="hidden items-stretch gap-4 sm:grid sm:grid-cols-3">
                {assignmentCard}
                {utilizationCard}
                {buildHeadsetsCard(editorDesktopRef)}
              </div>
            </>
          )
        })()}
      </div>

    </div>
  )
}
