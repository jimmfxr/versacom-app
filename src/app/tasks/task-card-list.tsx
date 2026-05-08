'use client'

import { useEffect, useRef, useState, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useBackgroundRefresh } from '@/hooks/use-background-refresh'
import { markDeployed, undoDeployed, markReturned, undoReturned } from './actions'
import { LocationSummary } from '@/components/location-summary'
import { FilterBar } from '@/components/filter-bar'
import { usePersistentState } from '@/lib/use-persistent-state'

const CATEGORY_LABELS: Record<string, string> = {
  panels: 'Panel',
  wireless_bp: 'Wireless beltpack',
  hardwire_bp: 'Hardwire beltpack',
  switches: 'Switch',
  antennas: 'Antenna',
  audio: 'Audio I/O',
}

const ASSIGNABLE_CATEGORIES = new Set(['panels', 'wireless_bp', 'hardwire_bp'])

export type TaskCard = {
  id: number
  name: string
  category: string
  hardwareType: string | null
  headsetType: string | null
  location: string | null
  effectiveLocation: string | null
  ipAddress: string | null
  deployStatus: string
  assignedToId: number | null
  gooseneck: boolean
  footswitches: number
  speakers: number
  projectName: string
  assignedTo: { name: string; position: string | null } | null
  /** 'deploy' = na item, button reads "Deployed". 'return' = done item, button reads "Returned". */
  mode: 'deploy' | 'return'
}

// Gear listed in the location summary doesn't need a `mode` — that's a
// task-only concern. Strip it from the shared GearItem type.
export type GearItem = Omit<TaskCard, 'mode'>

const UNDO_WINDOW_SECONDS = 10
const UNDO_WINDOW_MS = UNDO_WINDOW_SECONDS * 1000

type CardState = 'idle' | 'undo' | 'reverting'

export function TaskCardList({
  tasks,
  allGear,
  locations,
  searchValue,
  onSearchChange,
}: {
  tasks: TaskCard[]
  allGear: GearItem[]
  locations: string[]
  /** Optional externally-controlled search. When provided, the internal
   *  search input is hidden — the parent renders its own input (e.g. in
   *  the page header) and feeds the value down through this prop. */
  searchValue?: string
  onSearchChange?: (v: string) => void
}) {
  const router = useRouter()
  // Track per-card state so each card has its own independent undo timer.
  const [stateById, setStateById] = useState<Record<number, CardState>>({})
  const [secondsLeftById, setSecondsLeftById] = useState<Record<number, number>>({})
  const timersRef = useRef<Record<number, { tick: ReturnType<typeof setInterval>; expire: ReturnType<typeof setTimeout> }>>({})
  // Cards that have finished their undo countdown (timer expired). These get
  // suppressed from the visible list permanently for this session.
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set())
  // Frozen snapshots of cards currently in their undo window. We keep them
  // around even after the server-side data refresh removes them from `tasks`,
  // because revalidatePath fires immediately when the deploy server action
  // completes — without these snapshots the card would vanish in <1s.
  const [frozenTasks, setFrozenTasks] = useState<Record<number, TaskCard>>({})
  const [internalSearch, setInternalSearch] = useState('')
  const isExternalSearch = searchValue !== undefined
  const search = isExternalSearch ? (searchValue ?? '') : internalSearch
  const setSearch = isExternalSearch
    ? (v: string) => onSearchChange?.(v)
    : setInternalSearch
  const [selectedLocation, setSelectedLocation] = usePersistentState<string | null>(
    'tasks-locationFilter',
    null,
  )

  // Visibility-aware background refresh. Pauses while any card is
  // mid-undo / mid-revert so we don't redraw under an active timer.
  useBackgroundRefresh(6000, useCallback(
    () => Object.values(stateById).some((s) => s !== 'idle'),
    [stateById],
  ))

  // Cleanup all timers on unmount so we don't leak intervals.
  useEffect(() => {
    return () => {
      for (const id in timersRef.current) {
        clearInterval(timersRef.current[id].tick)
        clearTimeout(timersRef.current[id].expire)
      }
    }
  }, [])

  function startUndoTimer(id: number) {
    setStateById((s) => ({ ...s, [id]: 'undo' }))
    setSecondsLeftById((s) => ({ ...s, [id]: UNDO_WINDOW_SECONDS }))

    const tick = setInterval(() => {
      setSecondsLeftById((s) => {
        const next = (s[id] ?? UNDO_WINDOW_SECONDS) - 1
        return { ...s, [id]: next > 0 ? next : 0 }
      })
    }, 1000)

    const expire = setTimeout(() => {
      clearInterval(tick)
      delete timersRef.current[id]
      setDismissedIds((d) => {
        const next = new Set(d)
        next.add(id)
        return next
      })
      // Drop the frozen snapshot now that the card is gone for good.
      setFrozenTasks((f) => {
        const next = { ...f }
        delete next[id]
        return next
      })
    }, UNDO_WINDOW_MS)

    timersRef.current[id] = { tick, expire }
  }

  function cancelUndoTimer(id: number) {
    const t = timersRef.current[id]
    if (t) {
      clearInterval(t.tick)
      clearTimeout(t.expire)
      delete timersRef.current[id]
    }
  }

  function handlePrimary(id: number) {
    // Snapshot the task data NOW so we can keep rendering the card during its
    // 10s undo window even though the server-side revalidation will remove it
    // from the `tasks` prop almost immediately. The action chosen depends on
    // the card's mode — deploy cards call markDeployed, return cards call
    // markReturned.
    const task = tasks.find((t) => t.id === id)
    if (task) {
      setFrozenTasks((f) => ({ ...f, [id]: task }))
    }
    setStateById((s) => ({ ...s, [id]: 'undo' }))
    const action = task?.mode === 'return' ? markReturned : markDeployed
    void action(id).then((res) => {
      if (res?.error) {
        setStateById((s) => ({ ...s, [id]: 'idle' }))
        setFrozenTasks((f) => {
          const next = { ...f }
          delete next[id]
          return next
        })
        return
      }
      startUndoTimer(id)
    })
  }

  function handleUndo(id: number) {
    cancelUndoTimer(id)
    setStateById((s) => ({ ...s, [id]: 'reverting' }))
    const task = tasks.find((t) => t.id === id) ?? frozenTasks[id]
    const action = task?.mode === 'return' ? undoReturned : undoDeployed
    void action(id).then((res) => {
      if (res?.error) {
        setStateById((s) => ({ ...s, [id]: 'idle' }))
        return
      }
      setStateById((s) => ({ ...s, [id]: 'idle' }))
      // Drop the frozen snapshot — the server will repopulate this card
      // through `tasks` on the next render cycle.
      setFrozenTasks((f) => {
        const next = { ...f }
        delete next[id]
        return next
      })
      router.refresh()
    })
  }

  // Merge: server-provided tasks + any frozen snapshots that the server has
  // already removed (because the user just deployed them) but are still in
  // their undo window. Then suppress anything dismissed.
  const visibleMap = new Map<number, TaskCard>()
  for (const t of tasks) visibleMap.set(t.id, t)
  for (const id in frozenTasks) {
    const numId = Number(id)
    if (!visibleMap.has(numId)) visibleMap.set(numId, frozenTasks[numId])
  }
  const allVisible = Array.from(visibleMap.values()).filter((t) => !dismissedIds.has(t.id))

  // Apply location filter first (chip), then search filter.
  const locFiltered = selectedLocation
    ? allVisible.filter((t) => t.effectiveLocation === selectedLocation)
    : allVisible

  const q = search.trim().toLowerCase()
  const visible = q.length === 0
    ? locFiltered
    : locFiltered.filter((t) => {
        const haystack = [
          t.name,
          t.hardwareType,
          t.headsetType,
          t.location,
          t.ipAddress,
          t.projectName,
          t.assignedTo?.name,
          t.assignedTo?.position,
          CATEGORY_LABELS[t.category],
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })

  const SearchBar = (
    // pt-3 matches the equipment-details tab spacing — gives the chip
    // row 12px of breathing room below the page-header bottomBorder
    // line. mb-3 keeps existing spacing below.
    <div className="flex-shrink-0 -mx-4 mb-3 bg-[#202020] px-4 pt-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {/* Mobile-only internal search input. Desktop search lives on
          the chips row below (right side). */}
      {!isExternalSearch && (
        <div className="flex items-center gap-3 pb-3 sm:hidden">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by name, location, user, or model..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-white/10 px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white focus:border-[#0178a3]"
            />
          </div>
        </div>
      )}
      {locations.length > 0 && (
        // Desktop: chips on the left (flex-1, scroll if too many),
        // search input on the right of the same row. Mobile: chips
        // only — search lives in the page header / collapsible row.
        // The min-w-0 flex-1 wrapper around FilterBar is REQUIRED for
        // the ChipScroller's < > chevrons to appear: without it the
        // chip row sizes to its content, never overflows, and the
        // chevrons never trigger. (Same pattern as project details.)
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <FilterBar
              options={locations.map((loc) => ({ value: loc, label: loc }))}
              selected={selectedLocation}
              onSelect={(loc) => setSelectedLocation(loc)}
              visibleMobile={3}
              visibleDesktop={6}
              containerClassName="flex flex-1 gap-2 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            />
          </div>
          {/* ml-auto pushes the search input flush to the right edge
              of the row regardless of how few chips render. */}
          <div className="hidden sm:block">
            <input
              type="text"
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64 rounded-lg border border-white/10 px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white focus:border-[#0178a3]"
            />
          </div>
        </div>
      )}
    </div>
  )

  if (visible.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {SearchBar}
        <div data-scroll-container className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-none pb-4 pt-1 sm:pb-20">
          {selectedLocation && <LocationSummary location={selectedLocation} allGear={allGear} />}
          <div className="flex flex-col items-center px-6 py-12 text-center">
          <svg className="size-12 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <div className="mt-3 text-sm font-semibold text-white">
            {q.length > 0 ? 'No matches' : 'Inbox zero'}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {q.length > 0 ? 'No tasks match your search.' : 'All deployed. Nice work.'}
          </div>
          </div>
        </div>
      </div>
    )
  }

  // Split visible into Deploy and Return sections, each grouped by project.
  const deployVisible = visible.filter((t) => t.mode === 'deploy')
  const returnVisible = visible.filter((t) => t.mode === 'return')

  function groupByProject(list: TaskCard[]) {
    const m = new Map<string, TaskCard[]>()
    for (const t of list) {
      const arr = m.get(t.projectName) ?? []
      arr.push(t)
      m.set(t.projectName, arr)
    }
    return Array.from(m.entries())
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {SearchBar}
      {/* Single scroll region for everything below the search: Pull List
          card + Deploy / Return sections all scroll together so the
          Pull List doesn't pin and steal vertical space on mobile. */}
      <div data-scroll-container className="min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-none pb-4 pt-1 sm:pb-20">
        {selectedLocation && (
          <LocationSummary
            location={selectedLocation}
            allGear={allGear}
            label={returnVisible.length > 0 && deployVisible.length === 0 ? 'Return list' : 'Pull list'}
          />
        )}
        <TaskSection
          title="Deploy"
          cards={deployVisible}
          stateById={stateById}
          secondsLeftById={secondsLeftById}
          onPrimary={handlePrimary}
          onUndo={handleUndo}
          groupByProject={groupByProject}
        />
        <TaskSection
          title="Return"
          cards={returnVisible}
          stateById={stateById}
          secondsLeftById={secondsLeftById}
          onPrimary={handlePrimary}
          onUndo={handleUndo}
          groupByProject={groupByProject}
        />
      </div>
    </div>
  )
}

function TaskSection({
  title,
  cards,
  stateById,
  secondsLeftById,
  onPrimary,
  onUndo,
  groupByProject,
}: {
  title: string
  cards: TaskCard[]
  stateById: Record<number, CardState>
  secondsLeftById: Record<number, number>
  onPrimary: (id: number) => void
  onUndo: (id: number) => void
  groupByProject: (list: TaskCard[]) => Array<[string, TaskCard[]]>
}) {
  if (cards.length === 0) return null
  const grouped = groupByProject(cards)
  return (
    <div>
      <h3 className="mb-3 flex items-baseline gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        <span>{title}</span>
        <span className="text-gray-600">{cards.length}</span>
      </h3>
      <div className="space-y-4">
        {grouped.map(([projectName, items]) => (
          <div key={projectName}>
            {grouped.length > 1 && (
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                {projectName}
              </div>
            )}
            {/* Border on the BOTTOM of each card (not divide-y, which
                draws on the top of children 2-N). With border-b every
                card "owns" the line below it, so the list ends with a
                closing line under the last card — matches the page-
                header bottomBorder + first-card pattern other pages
                rely on. */}
            <div className="[&>*]:border-b [&>*]:border-white/[0.06]">
              {items.map((task) => (
                <TaskCardItem
                  key={task.id}
                  task={task}
                  state={stateById[task.id] ?? 'idle'}
                  secondsLeft={secondsLeftById[task.id] ?? 10}
                  onPrimary={() => onPrimary(task.id)}
                  onUndo={() => onUndo(task.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TaskCardItem({
  task,
  state,
  secondsLeft,
  onPrimary,
  onUndo,
}: {
  task: TaskCard
  state: CardState
  secondsLeft: number
  onPrimary: () => void
  onUndo: () => void
}) {
  const [pending, startTransition] = useTransition()
  const isAssignable = ASSIGNABLE_CATEGORIES.has(task.category)

  return (
    <div
      className={`flex items-start gap-4 py-3 transition-all ${
        state === 'idle' ? 'hover:bg-white/[0.04]' : 'opacity-60'
      }`}
    >
      {/* Content — matches the equipment row layout on the project page */}
      <div className="min-w-0 flex-1">
        {/* Row 1: name + assignee */}
        <div className="text-sm font-semibold">
          <span className="text-white">{task.name || task.hardwareType || CATEGORY_LABELS[task.category]}</span>
          {task.assignedTo ? (
            <>
              <span className="hidden sm:inline text-gray-500"> · </span>
              <span className="hidden sm:inline text-[#22a7d3]">
                {task.assignedTo.name}
                {task.assignedTo.position && (
                  <span className="text-[#22a7d3]/70"> · {task.assignedTo.position}</span>
                )}
              </span>
              <div className="sm:hidden mt-0.5 text-[#22a7d3] font-normal">
                {task.assignedTo.name}
                {task.assignedTo.position && (
                  <span className="text-[#22a7d3]/70"> · {task.assignedTo.position}</span>
                )}
              </div>
            </>
          ) : isAssignable ? (
            <>
              <span className="hidden sm:inline text-gray-500"> · </span>
              <span className="hidden sm:inline italic text-gray-400">Unassigned</span>
              <div className="sm:hidden mt-0.5 italic text-gray-400 font-normal">Unassigned</div>
            </>
          ) : null}
        </div>

        {/* Row 2: details */}
        <div className="mt-1 text-sm text-gray-300">
          {/* Mobile: each field on its own row */}
          <div className="flex flex-col gap-0.5 sm:hidden">
            {task.location && <span><span className="text-xs text-gray-500">Location: </span>{task.location}</span>}
            {task.hardwareType && <span><span className="text-xs text-gray-500">Hardware: </span>{task.hardwareType}</span>}
            {task.headsetType && <span><span className="text-xs text-gray-500">Headset: </span>{task.headsetType}</span>}
            {task.ipAddress && <span><span className="text-xs text-gray-500">IP: </span><span className="font-mono text-[#22a7d3]">{task.ipAddress}</span></span>}
          </div>
          {/* Desktop: inline with dots */}
          <div className="hidden sm:flex flex-wrap items-center gap-x-1.5">
            {task.location && <><span className="text-xs text-gray-500">Location: </span><span>{task.location}</span></>}
            {task.hardwareType && <><span className="text-gray-500">·</span><span className="text-xs text-gray-500">Hardware: </span><span>{task.hardwareType}</span></>}
            {task.headsetType && <><span className="text-gray-500">·</span><span className="text-xs text-gray-500">Headset: </span><span>{task.headsetType}</span></>}
            {task.ipAddress && <><span className="text-gray-500">·</span><span className="text-xs text-gray-500">IP: </span><span className="font-mono text-[#22a7d3]">{task.ipAddress}</span></>}
          </div>
        </div>
      </div>

      {/* Action button */}
      <div className="flex shrink-0 items-center">
        {state === 'idle' && (
          <button
            type="button"
            onClick={() => startTransition(onPrimary)}
            disabled={pending}
            className="rounded-md bg-[#0178a3] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:opacity-60"
          >
            {task.mode === 'return' ? 'Returned' : 'Deployed'}
          </button>
        )}
        {state === 'undo' && (
          <button
            type="button"
            onClick={onUndo}
            className="relative overflow-hidden rounded-md bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/[0.14]"
          >
            <span className="relative z-10">Undo · {secondsLeft}s</span>
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-[#22a7d3]/30 transition-[width] duration-1000 ease-linear"
              style={{ width: `${(secondsLeft / UNDO_WINDOW_SECONDS) * 100}%` }}
            />
          </button>
        )}
        {state === 'reverting' && <span className="px-3 py-1.5 text-xs text-gray-400">Restoring…</span>}
      </div>
    </div>
  )
}
