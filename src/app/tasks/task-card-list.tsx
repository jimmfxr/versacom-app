'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markDeployed, undoDeployed } from './actions'
import { LocationSummary } from '@/components/location-summary'

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
  projectName: string
  assignedTo: { name: string; position: string | null } | null
}

export type GearItem = TaskCard

const UNDO_WINDOW_SECONDS = 10
const UNDO_WINDOW_MS = UNDO_WINDOW_SECONDS * 1000

type CardState = 'idle' | 'undo' | 'reverting'

export function TaskCardList({
  tasks,
  allGear,
  locations,
}: {
  tasks: TaskCard[]
  allGear: GearItem[]
  locations: string[]
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
  const [search, setSearch] = useState('')
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null)
  const [showAllLocations, setShowAllLocations] = useState(false)

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

  function handleDeployed(id: number) {
    // Snapshot the task data NOW so we can keep rendering the card during its
    // 20s undo window even though the server-side revalidation will remove it
    // from the `tasks` prop almost immediately.
    const task = tasks.find((t) => t.id === id)
    if (task) {
      setFrozenTasks((f) => ({ ...f, [id]: task }))
    }
    setStateById((s) => ({ ...s, [id]: 'undo' }))
    void markDeployed(id).then((res) => {
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
    void undoDeployed(id).then((res) => {
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
    <div className="sticky top-16 z-20 -mx-4 mb-3 bg-[#202020] px-4 pt-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex items-center gap-3 pb-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by name, location, user, or model..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-2.5 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
          />
        </div>
      </div>
      {locations.length > 0 && (
        <LocationChips
          locations={locations}
          selected={selectedLocation}
          onSelect={(loc) => {
            setSelectedLocation(loc)
            setShowAllLocations(false)
          }}
          showAll={showAllLocations}
          onToggleShowAll={() => setShowAllLocations((v) => !v)}
        />
      )}
    </div>
  )

  if (visible.length === 0) {
    return (
      <>
        {SearchBar}
        {selectedLocation && <LocationSummary location={selectedLocation} allGear={allGear} />}
        <div className="flex flex-col items-center rounded-2xl bg-[#2a2a2a] px-6 py-12 text-center">
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
      </>
    )
  }

  // Group cards by project so the user sees a tidy section per show.
  const grouped = (() => {
    const m = new Map<string, TaskCard[]>()
    for (const t of visible) {
      const list = m.get(t.projectName) ?? []
      list.push(t)
      m.set(t.projectName, list)
    }
    return Array.from(m.entries())
  })()

  return (
    <>
      {SearchBar}
      {selectedLocation && <LocationSummary location={selectedLocation} allGear={allGear} />}
      <div className="space-y-6">
      {grouped.map(([projectName, items]) => (
        <div key={projectName}>
          {grouped.length > 1 && (
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
              {projectName}
            </div>
          )}
          <div className="space-y-2">
            {items.map((task) => (
              <TaskCardItem
                key={task.id}
                task={task}
                state={stateById[task.id] ?? 'idle'}
                secondsLeft={secondsLeftById[task.id] ?? 10}
                onDeployed={() => handleDeployed(task.id)}
                onUndo={() => handleUndo(task.id)}
              />
            ))}
          </div>
        </div>
      ))}
      </div>
    </>
  )
}

function TaskCardItem({
  task,
  state,
  secondsLeft,
  onDeployed,
  onUndo,
}: {
  task: TaskCard
  state: CardState
  secondsLeft: number
  onDeployed: () => void
  onUndo: () => void
}) {
  const [pending, startTransition] = useTransition()
  const isAssignable = ASSIGNABLE_CATEGORIES.has(task.category)

  return (
    <div
      className={`flex items-start gap-4 rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-all ${
        state === 'idle' ? 'hover:bg-[#313131]' : 'opacity-60'
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
            onClick={() => startTransition(onDeployed)}
            disabled={pending}
            className="rounded-md bg-[#0178a3] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:opacity-60"
          >
            Deployed
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

const VISIBLE_CHIP_COUNT_MOBILE = 3
const VISIBLE_CHIP_COUNT_DESKTOP = 6

function LocationChips({
  locations,
  selected,
  onSelect,
  showAll,
  onToggleShowAll,
}: {
  locations: string[]
  selected: string | null
  onSelect: (loc: string | null) => void
  showAll: boolean
  onToggleShowAll: () => void
}) {
  // We render two chip rows (mobile + desktop) so each can have its own
  // overflow threshold. Tailwind's responsive utilities pick which is visible.
  const overflowMobile = locations.length > VISIBLE_CHIP_COUNT_MOBILE
  const overflowDesktop = locations.length > VISIBLE_CHIP_COUNT_DESKTOP

  return (
    <div className="pb-3">
      {/* Mobile row */}
      <div className="flex flex-wrap gap-2 sm:hidden">
        <Chip active={selected === null} onClick={() => onSelect(null)}>
          All
        </Chip>
        {(showAll ? locations : locations.slice(0, VISIBLE_CHIP_COUNT_MOBILE)).map((loc) => (
          <Chip key={loc} active={selected === loc} onClick={() => onSelect(loc)}>
            {loc}
          </Chip>
        ))}
        {overflowMobile && (
          <button
            type="button"
            onClick={onToggleShowAll}
            className="rounded-full border border-white/[0.10] bg-[#2a2a2a] px-3 py-1 text-xs font-semibold text-gray-300 transition-colors hover:bg-[#313131]"
          >
            {showAll ? 'Show less' : `+${locations.length - VISIBLE_CHIP_COUNT_MOBILE} more`}
          </button>
        )}
      </div>
      {/* Desktop row */}
      <div className="hidden flex-wrap gap-2 sm:flex">
        <Chip active={selected === null} onClick={() => onSelect(null)}>
          All
        </Chip>
        {(showAll ? locations : locations.slice(0, VISIBLE_CHIP_COUNT_DESKTOP)).map((loc) => (
          <Chip key={loc} active={selected === loc} onClick={() => onSelect(loc)}>
            {loc}
          </Chip>
        ))}
        {overflowDesktop && (
          <button
            type="button"
            onClick={onToggleShowAll}
            className="rounded-full border border-white/[0.10] bg-[#2a2a2a] px-3 py-1 text-xs font-semibold text-gray-300 transition-colors hover:bg-[#313131]"
          >
            {showAll ? 'Show less' : `+${locations.length - VISIBLE_CHIP_COUNT_DESKTOP} more`}
          </button>
        )}
      </div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'bg-[#0178a3] text-white'
          : 'border border-white/[0.10] bg-[#2a2a2a] text-gray-300 hover:bg-[#313131]'
      }`}
    >
      {children}
    </button>
  )
}
