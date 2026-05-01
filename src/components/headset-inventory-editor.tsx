'use client'

import { useState, useTransition } from 'react'
import { setHeadsetInventory } from '@/app/projects/[id]/actions'

const HEADSET_TYPES = [
  'LWHS 4', 'LWHS 5', 'PH 88', 'Shure Single', 'Shure Double',
  'Pliant Single', 'Pliant Double', 'Max D2', 'DT 200', 'DT 280',
  'DT 290', 'Dave Clark', 'Peltor', 'Dalcom',
] as const

type Props = {
  projectId: number
  initial: Array<{ headsetType: string; brought: number }>
  needed: Record<string, number>
  onDone: () => void
}

/**
 * Inline editor for the per-project "headsets brought to the show" inventory.
 * Renders inside the Headsets dashboard card, swapping in for the display content
 * while editing.
 */
export function HeadsetInventoryEditor({ projectId, initial, needed, onDone }: Props) {
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
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

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
      const res = await setHeadsetInventory(projectId, payload)
      if (res?.error) {
        setErr(res.error)
        return
      }
      onDone()
    })
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
        {HEADSET_TYPES.map((type) => {
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
                <button
                  type="button"
                  onClick={() => bump(type, -1)}
                  disabled={v <= 0 || pending}
                  className="flex size-8 items-center justify-center rounded-md bg-white/[0.05] text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Decrease ${type}`}
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={9999}
                  value={v}
                  onChange={(e) => setExact(type, e.target.value)}
                  disabled={pending}
                  className="w-14 rounded-md border border-white/10 bg-[#1f1f1f] py-1 text-center text-sm font-semibold text-white outline-none focus:border-[#0178a3]"
                />
                <button
                  type="button"
                  onClick={() => bump(type, 1)}
                  disabled={pending}
                  className="flex size-8 items-center justify-center rounded-md bg-white/[0.05] text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Increase ${type}`}
                >
                  +
                </button>
              </div>
            </div>
          )
        })}
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
