'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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

type ProjectDashboardProps = {
  equipment: EquipmentForDashboard[]
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

type TypeBreakdown = { type: string; count: number; total: number }

function groupByHardwareType(
  equipment: EquipmentForDashboard[],
  category: string,
  countMatches: (e: EquipmentForDashboard) => boolean,
): TypeBreakdown[] {
  const rows = equipment.filter((e) => e.category === category)
  const byType = new Map<string, { count: number; total: number }>()
  for (const e of rows) {
    const key = e.hardwareType || '(unset)'
    const cur = byType.get(key) ?? { count: 0, total: 0 }
    cur.total += 1
    if (countMatches(e)) cur.count += 1
    byType.set(key, cur)
  }
  return Array.from(byType.entries())
    .map(([type, { count, total }]) => ({ type, count, total }))
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

function BarRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="mb-3 grid grid-cols-[110px_1fr_auto] items-center gap-3 last:mb-0 sm:grid-cols-[120px_1fr_auto] sm:gap-3.5">
      <div className="truncate text-[11px] font-medium text-gray-300 sm:text-xs">{label}</div>
      <div className="flex h-[18px] overflow-hidden rounded-md bg-white/[0.05]">
        <div className="h-full bg-[#22a7d3]" style={{ width: `${pct}%` }} />
        <div className="h-full bg-white/[0.12]" style={{ width: `${100 - pct}%` }} />
      </div>
      <div className="min-w-[60px] text-right font-mono text-[10px] tabular-nums text-gray-400 sm:min-w-[80px] sm:text-[11px]">
        <span className="font-semibold text-white">{count}</span> / {total}
      </div>
    </div>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-3.5 border-b border-white/[0.05] pb-1 text-[9px] font-bold uppercase tracking-wider text-gray-500 first:mt-0">
      {children}
    </div>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="py-5 text-center text-xs text-gray-500">{children}</div>
}

function CardHeader({ title, subtitle, tag }: { title: string; subtitle?: string; tag?: string }) {
  return (
    <div className="mb-4 flex items-start justify-between">
      <div>
        <div className="text-[13px] font-semibold text-gray-200">{title}</div>
        {subtitle && <div className="mt-0.5 text-[11px] text-gray-500">{subtitle}</div>}
      </div>
      {tag && (
        <span className="inline-block rounded-full bg-[#22a7d3]/15 px-2 py-0.5 text-[10px] font-semibold text-[#22a7d3]">
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

export function ProjectDashboard({ equipment }: ProjectDashboardProps) {
  /* Status counts — "Done" tracks actively deployed gear only */
  const doneEligible = equipment.filter((e) => {
    if (e.category === 'wireless_bp') return false // wireless excluded
    if (e.deployStatus === 'not-needed') return false // inventory only, not deployment
    if (ASSIGNABLE_CATEGORIES.includes(e.category) && !e.assignedToId) return false // unassigned panels/hardwire
    if (['switches', 'antennas'].includes(e.category) && (!e.location || !e.location.trim())) return false // switches/antennas without a location
    return true
  })
  const doneTotal = doneEligible.length
  const doneCount = doneEligible.filter((e) => e.deployStatus === 'done').length

  const returnedTotal = equipment.length
  const returnedCount = equipment.filter((e) => e.deployStatus === 'returned').length

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

  /* Headsets — pulled from headsetType field on beltpacks/panels */
  const headsetRows = (() => {
    const byType = new Map<string, { count: number; total: number }>()
    for (const e of equipment) {
      if (!e.headsetType || !e.headsetType.trim()) continue
      const key = e.headsetType.trim()
      const cur = byType.get(key) ?? { count: 0, total: 0 }
      cur.total += 1
      if (e.assignedToId != null) cur.count += 1
      byType.set(key, cur)
    }
    return Array.from(byType.entries())
      .map(([type, { count, total }]) => ({ type, count, total }))
      .sort((a, b) => b.total - a.total)
  })()
  const headsetsCount = headsetRows.reduce((s, r) => s + r.count, 0)
  const headsetsTotal = headsetRows.reduce((s, r) => s + r.total, 0)

  return (
    <div className="space-y-5">
      {/* Status hero row */}
      <div>
        <SectionHeader>Deployment status</SectionHeader>
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <StatusHero
            count={doneCount}
            total={doneTotal}
            label="Done"
            sublabel={`${doneTotal - doneCount} still to go`}
            color="cyan"
            detail={`${doneCount} of ${doneTotal} items`}
          />
          <StatusHero
            count={returnedCount}
            total={returnedTotal}
            label="Returned"
            sublabel={`${returnedTotal - returnedCount} remaining`}
            color="purple"
            detail={`${returnedCount} of ${returnedTotal} items`}
          />
        </div>
      </div>

      {/* Distribution: 2-col grid */}
      <div>
        <SectionHeader>Distribution</SectionHeader>
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 sm:gap-4">
          {/* Assignment by hardware type */}
          <div className="rounded-2xl bg-[#2a2a2a] p-4 sm:p-5">
            <CardHeader
              title="Assigned to a user"
              subtitle="Who has what, by model"
              tag={`${assignmentCount} / ${assignmentTotal}`}
            />
            {assignmentTotal === 0 ? (
              <EmptyRow>No assignable equipment yet</EmptyRow>
            ) : (
              assignmentGroups.map((g) => (
                <div key={g.cat}>
                  <GroupLabel>{g.label}</GroupLabel>
                  {g.rows.length === 0 ? (
                    <EmptyRow>No {g.label.toLowerCase()} in this project</EmptyRow>
                  ) : (
                    g.rows.map((r) => (
                      <BarRow key={r.type} label={r.type} count={r.count} total={r.total} />
                    ))
                  )}
                </div>
              ))
            )}
          </div>

          {/* Infrastructure utilization */}
          <div className="rounded-2xl bg-[#2a2a2a] p-4 sm:p-5">
            <CardHeader
              title="In use on the show"
              subtitle="Items with a location set, by model"
              tag={`${utilizationCount} / ${utilizationTotal}`}
            />
            {utilizationTotal === 0 ? (
              <EmptyRow>No infrastructure equipment yet</EmptyRow>
            ) : (
              utilizationGroups.map((g) => (
                <div key={g.cat}>
                  <GroupLabel>{g.label}</GroupLabel>
                  {g.rows.length === 0 ? (
                    <EmptyRow>No {g.label.toLowerCase()} equipment in this project</EmptyRow>
                  ) : (
                    g.rows.map((r) => (
                      <BarRow key={r.type} label={r.type} count={r.count} total={r.total} />
                    ))
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Headsets — separate full-width card */}
      <div>
        <SectionHeader>Headsets</SectionHeader>
        <div className="rounded-2xl bg-[#2a2a2a] p-4 sm:p-5">
          <CardHeader
            title="Headsets assigned"
            subtitle="Counted from the headset chosen on each beltpack"
            tag={headsetsTotal > 0 ? `${headsetsCount} / ${headsetsTotal}` : undefined}
          />
          {headsetRows.length === 0 ? (
            <EmptyRow>No headsets assigned to any equipment in this project</EmptyRow>
          ) : (
            headsetRows.map((r) => (
              <BarRow key={r.type} label={r.type} count={r.count} total={r.total} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
