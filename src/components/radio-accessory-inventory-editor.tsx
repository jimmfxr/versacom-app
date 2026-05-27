'use client'

import { useState, useTransition } from 'react'
import { setAccessoryInventory } from '@/app/radios/actions'

/**
 * Inline editor for the per-project radio-accessory inventory. Mirrors
 * the headsets / misc editor on Comms (HeadsetInventoryEditor):
 * renders every accessory type as a row with - / number input / +
 * bumpers, and one Save commits the whole batch in a transaction.
 *
 * The four supported accessories are hard-coded here because the
 * matching boolean flags on Radio + the per-Radio scanner flow only
 * know these four values. Add a new one here AND in
 * src/app/radios/actions.ts ACCESSORY_TYPES if the inventory grows.
 */
const ACCESSORY_DEFS: ReadonlyArray<{
  key: 'fistMic' | 'surveillance' | 'doubleMuff' | 'lightweight'
  label: string
}> = [
  { key: 'fistMic', label: 'Fist mic' },
  { key: 'surveillance', label: 'Surveillance' },
  { key: 'doubleMuff', label: 'Double' },
  { key: 'lightweight', label: 'LWHS' },
] as const

type Props = {
  projectId: number
  /** Per-type "brought" counts loaded from ProjectAccessoryInventory.
   *  Keyed by accessoryType. Missing keys default to 0. */
  initial: Record<string, number>
  onDone: () => void
}

export function RadioAccessoryInventoryEditor({ projectId, initial, onDone }: Props) {
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    for (const d of ACCESSORY_DEFS) {
      map[d.key] = initial[d.key] ?? 0
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
    const payload = ACCESSORY_DEFS.map((d) => ({
      accessoryType: d.key,
      brought: counts[d.key] ?? 0,
    }))
    startTransition(async () => {
      const res = await setAccessoryInventory(projectId, payload)
      if (res?.error) {
        setErr(res.error)
        return
      }
      onDone()
    })
  }

  return (
    <div>
      <div className="mb-4">
        <div className="text-base font-semibold text-white">Manage Inventory</div>
        <div className="mt-0.5 text-xs text-gray-500">
          How many of each accessory you packed for this show
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.06]">
        {ACCESSORY_DEFS.map((d, i) => {
          const v = counts[d.key] ?? 0
          const last = i === ACCESSORY_DEFS.length - 1
          return (
            <div
              key={d.key}
              className={`flex items-center justify-between gap-3 px-3 py-2 ${
                last ? '' : 'border-b border-white/[0.04]'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white">{d.label}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => bump(d.key, -1)}
                  disabled={v <= 0 || pending}
                  aria-label={`Decrease ${d.label}`}
                  className="flex size-8 items-center justify-center rounded-md bg-white/[0.05] text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={9999}
                  value={v}
                  onChange={(e) => setExact(d.key, e.target.value)}
                  disabled={pending}
                  className="w-14 rounded-md border border-white/10 bg-[#1f1f1f] py-1 text-center text-sm font-semibold text-white outline-none focus:border-[#0178a3]"
                />
                <button
                  type="button"
                  onClick={() => bump(d.key, 1)}
                  disabled={pending}
                  aria-label={`Increase ${d.label}`}
                  className="flex size-8 items-center justify-center rounded-md bg-white/[0.05] text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {err && <div className="mt-3 text-xs text-rose-400">{err}</div>}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="w-full rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
