'use client'

import { useState, useTransition } from 'react'
import { setHeadsetInventory, setMiscInventory } from '@/app/projects/[id]/actions'

const HEADSET_TYPES = [
  'LWHS 4', 'LWHS 5', 'PH 88', 'Shure Single', 'Shure Double',
  'Pliant Single', 'Pliant Double', 'Max D2', 'DT 200', 'DT 280',
  'DT 290', 'Dave Clark', 'Peltor', 'Dalcom',
] as const

type MiscInventoryEdit = {
  goosenecksBrought: number
  footswitchesBrought: number
  speakersBrought: number
}

type MiscNeeded = {
  goosenecks: number
  footswitches: number
  speakers: number
}

type Props = {
  projectId: number
  initial: Array<{ headsetType: string; brought: number }>
  needed: Record<string, number>
  miscInitial: MiscInventoryEdit
  miscNeeded: MiscNeeded
  onDone: () => void
}

/**
 * Inline editor for the per-project "headsets brought to the show" inventory.
 * Renders inside the Headsets dashboard card, swapping in for the display content
 * while editing.
 */
export function HeadsetInventoryEditor({ projectId, initial, needed, miscInitial, miscNeeded, onDone }: Props) {
  // Track which types had a record saved server-side so we can tell the
  // difference between "manager packed 0" and "we just defaulted to needed".
  const savedTypes = new Set(initial.map((r) => r.headsetType))
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    for (const t of HEADSET_TYPES) {
      // Pre-populate from saved inventory; otherwise default to whatever
      // the show currently needs (so admins don't retype counts that are
      // already implied by beltpack assignments).
      map[t] = savedTypes.has(t)
        ? initial.find((r) => r.headsetType === t)!.brought
        : (needed[t] ?? 0)
    }
    return map
  })
  // Misc inventory — same "tracked vs implicit needed" pattern as headsets.
  const [misc, setMisc] = useState<MiscInventoryEdit>({
    goosenecksBrought:
      miscInitial.goosenecksBrought > 0 ? miscInitial.goosenecksBrought : miscNeeded.goosenecks,
    footswitchesBrought:
      miscInitial.footswitchesBrought > 0 ? miscInitial.footswitchesBrought : miscNeeded.footswitches,
    speakersBrought:
      miscInitial.speakersBrought > 0 ? miscInitial.speakersBrought : miscNeeded.speakers,
  })
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  // Section collapse state — long headset list can be hidden to focus on misc.
  const [headsetsCollapsed, setHeadsetsCollapsed] = useState(false)
  const [miscCollapsed, setMiscCollapsed] = useState(false)

  function bump(type: string, delta: number) {
    setCounts((c) => ({
      ...c,
      [type]: Math.max(0, Math.min(9999, (c[type] ?? 0) + delta)),
    }))
  }

  function setExact(type: string, raw: string) {
    const n = parseInt(raw, 10)
    setCounts((c) => ({
      ...c,
      [type]: Number.isFinite(n) && n >= 0 ? Math.min(9999, n) : 0,
    }))
  }

  function handleSave() {
    setErr(null)
    const payload = HEADSET_TYPES.map((t) => ({
      headsetType: t,
      brought: counts[t] ?? 0,
    }))
    startTransition(async () => {
      const [headsetRes, miscRes] = await Promise.all([
        setHeadsetInventory(projectId, payload),
        setMiscInventory(projectId, misc),
      ])
      if (headsetRes?.error) {
        setErr(headsetRes.error)
        return
      }
      if (miscRes?.error) {
        setErr(miscRes.error)
        return
      }
      onDone()
    })
  }

  function bumpMisc(field: keyof MiscInventoryEdit, delta: number) {
    setMisc((m) => ({
      ...m,
      [field]: Math.max(0, Math.min(9999, m[field] + delta)),
    }))
  }
  function setMiscExact(field: keyof MiscInventoryEdit, raw: string) {
    const n = parseInt(raw, 10)
    setMisc((m) => ({
      ...m,
      [field]: Number.isFinite(n) && n >= 0 ? Math.min(9999, n) : 0,
    }))
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-white">Manage Inventory</div>
          <div className="mt-0.5 text-xs text-gray-500">How many of each you packed for this show</div>
        </div>
      </div>

      <div className="-mx-1 pr-1">
        {/* Headsets section */}
        <SectionHeader
          collapsed={headsetsCollapsed}
          onToggle={() => setHeadsetsCollapsed((v) => !v)}
        >
          Headsets
        </SectionHeader>
        {!headsetsCollapsed && HEADSET_TYPES.map((type) => {
          const v = counts[type] ?? 0
          const need = needed[type] ?? 0
          const short = v > 0 && v < need
          return (
            <div
              key={type}
              className="flex items-center justify-between gap-3 border-b border-white/[0.04] py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white">{type}</div>
                {need > 0 && (
                  <div className={`text-[11px] ${short ? 'text-rose-400' : 'text-gray-500'}`}>
                    {need} needed{short ? ` · short ${need - v}` : ''}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => bump(type, -1)} disabled={v <= 0 || pending}
                  className="flex size-8 items-center justify-center rounded-md bg-white/[0.05] text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Decrease ${type}`}>−</button>
                <input type="number" inputMode="numeric" min={0} max={9999} value={v}
                  onChange={(e) => setExact(type, e.target.value)} disabled={pending}
                  className="w-14 rounded-md border border-white/10 bg-[#1f1f1f] py-1 text-center text-sm font-semibold text-white outline-none focus:border-[#0178a3]" />
                <button type="button" onClick={() => bump(type, 1)} disabled={pending}
                  className="flex size-8 items-center justify-center rounded-md bg-white/[0.05] text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Increase ${type}`}>+</button>
              </div>
            </div>
          )
        })}

        {/* Misc section */}
        <SectionHeader
          collapsed={miscCollapsed}
          onToggle={() => setMiscCollapsed((v) => !v)}
        >
          Misc
        </SectionHeader>
        {!miscCollapsed && (
          <>
            <MiscRow
              label="Goosenecks"
              needed={miscNeeded.goosenecks}
              value={misc.goosenecksBrought}
              onBump={(d) => bumpMisc('goosenecksBrought', d)}
              onSet={(raw) => setMiscExact('goosenecksBrought', raw)}
              pending={pending}
            />
            <MiscRow
              label="Footswitches"
              needed={miscNeeded.footswitches}
              value={misc.footswitchesBrought}
              onBump={(d) => bumpMisc('footswitchesBrought', d)}
              onSet={(raw) => setMiscExact('footswitchesBrought', raw)}
              pending={pending}
            />
            <MiscRow
              label="Speakers"
              needed={miscNeeded.speakers}
              value={misc.speakersBrought}
              onBump={(d) => bumpMisc('speakersBrought', d)}
              onSet={(raw) => setMiscExact('speakersBrought', raw)}
              pending={pending}
            />
          </>
        )}
      </div>

      {err && <div className="mt-3 shrink-0 text-xs text-rose-400">{err}</div>}

      <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-400 transition-colors hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function SectionHeader({
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
      className="mt-3 flex w-full items-center justify-between border-b border-white/[0.05] pb-1.5 pt-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 transition-colors first:mt-0 first:pt-0 hover:text-gray-200"
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

function MiscRow({
  label,
  needed,
  value,
  onBump,
  onSet,
  pending,
}: {
  label: string
  needed: number
  value: number
  onBump: (delta: number) => void
  onSet: (raw: string) => void
  pending: boolean
}) {
  const short = value > 0 && value < needed
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[0.04] py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white">{label}</div>
        {needed > 0 && (
          <div className={`text-[11px] ${short ? 'text-rose-400' : 'text-gray-500'}`}>
            {needed} needed{short ? ` · short ${needed - value}` : ''}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onBump(-1)}
          disabled={value <= 0 || pending}
          className="flex size-8 items-center justify-center rounded-md bg-white/[0.05] text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={9999}
          value={value}
          onChange={(e) => onSet(e.target.value)}
          disabled={pending}
          className="w-14 rounded-md border border-white/10 bg-[#1f1f1f] py-1 text-center text-sm font-semibold text-white outline-none focus:border-[#0178a3]"
        />
        <button
          type="button"
          onClick={() => onBump(1)}
          disabled={pending}
          className="flex size-8 items-center justify-center rounded-md bg-white/[0.05] text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  )
}
