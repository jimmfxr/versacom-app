'use client'

import { useState, useTransition } from 'react'
import { updateMultStrand } from '@/app/projects/[id]/distribution/actions'
import { SearchableSelect } from '@/components/searchable-select'
import {
  type MultHardwareType,
  strandColor,
  attachableMult,
  STRAND_ATTACH_CATEGORIES,
} from '@/lib/mults'

type StrandData = {
  id: number
  index: number
  channelName: string
  attachedEquipmentId: number | null
}

type EquipmentLookup = {
  id: number
  name: string
  category: string
  hardwareType: string | null
  /** Antenna free-form "Name" — stored in Equipment.position. Shown
   *  next to the ID in the strand attach dropdown for Pliant antennas
   *  so the option reads "ANT 3 · FOH Bolero". */
  position: string | null
  /** Switch location — shown next to the ID in the strand attach
   *  dropdown so the option reads "SW 1 · FOH". */
  location: string | null
}

/**
 * Read-only header for a mult on the Equipment tab. No chevron — the
 * row just shows the mult's identity (name + hardware + length +
 * location + strand count) and an Edit button. Tapping Edit defers
 * to the parent's existing edit flow, which renders the standard
 * equipment edit form AND the strand list below via MultStrandList.
 */
export function MultRowHeader({
  mult,
  onEdit,
  canEdit,
}: {
  mult: {
    id: number
    name: string
    hardwareType: string | null
    location: string | null
    lengthFeet: number | null
    strands: StrandData[]
  }
  onEdit: () => void
  canEdit: boolean
}) {
  const isAttachable = attachableMult((mult.hardwareType ?? 'Fiber') as MultHardwareType)

  return (
    // Matches the wrapper used by every other equipment row in
    // ProjectPage's filteredEquipment map — same gap-4 / py-3 / hover
    // tint so the parent's divide-y border-b separator lines up
    // cleanly across mult and non-mult rows.
    <div className="flex items-start gap-4 py-3 transition-colors hover:bg-white/[0.04]">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          <span className="text-white">{mult.name}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-400">
          {mult.hardwareType && <><span className="text-xs text-gray-500">Type: </span><span>{mult.hardwareType}</span></>}
          {mult.lengthFeet && <><span className="text-gray-500">·</span><span className="text-xs text-gray-500">Length: </span><span>{mult.lengthFeet}{"'"}</span></>}
          {mult.location && <><span className="text-gray-500">·</span><span className="text-xs text-gray-500">Location: </span><span>{mult.location}</span></>}
          <span className="text-gray-500">·</span>
          <span className="text-xs text-gray-500">{mult.strands.length} {isAttachable ? 'strands' : 'pairs'}</span>
        </div>
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Inline strand list — rendered below the Edit form when a mult is in
 * edit mode. Each row: number + color chip + channel-name input +
 * attach dropdown (Fiber / Ethernet only). Saves are sent per-field
 * to updateMultStrand and are independent of the equipment Save
 * button (so the user can edit strands without immediately saving
 * the rest of the form).
 */
export function MultStrandList({
  projectId,
  mult,
  allEquipment,
  attachedElsewhere,
}: {
  projectId: number
  mult: {
    id: number
    hardwareType: string | null
    strands: StrandData[]
  }
  allEquipment: EquipmentLookup[]
  attachedElsewhere: Set<number>
}) {
  const hwType = (mult.hardwareType ?? 'Fiber') as MultHardwareType
  const isAttachable = attachableMult(hwType)
  // Header collapses the strand list — chevron on the far LEFT of
  // the "Strands" / "Pairs" label flips rotation between right
  // (collapsed) and down (expanded). Defaults to expanded since the
  // list only renders after the user has tapped Edit on the mult.
  const [expanded, setExpanded] = useState(true)

  const allowedCategories = new Set(STRAND_ATTACH_CATEGORIES[hwType])
  const attachOptions = allEquipment.filter((e) => {
    if (e.id === mult.id) return false
    if (!allowedCategories.has(e.category)) return false
    if (hwType === 'Fiber' && e.category === 'antennas' && e.hardwareType !== 'Pliant') return false
    if (attachedElsewhere.has(e.id)) return false
    return true
  })

  if (mult.strands.length === 0) return null
  return (
    <div className="mt-4 space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 transition-colors hover:text-gray-200"
        aria-expanded={expanded}
      >
        <span>{isAttachable ? 'Strands' : 'Pairs'}</span>
        <svg
          className={`size-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="5 8 10 13 15 8" />
        </svg>
      </button>
      {expanded && mult.strands.map((strand) => (
        <StrandRow
          key={strand.id}
          projectId={projectId}
          strand={strand}
          hwType={hwType}
          isAttachable={isAttachable}
          attachOptions={attachOptions}
          allEquipment={allEquipment}
        />
      ))}
    </div>
  )
}

function StrandRow({
  projectId,
  strand,
  hwType,
  isAttachable,
  attachOptions,
  allEquipment,
}: {
  projectId: number
  strand: StrandData
  hwType: MultHardwareType
  isAttachable: boolean
  attachOptions: EquipmentLookup[]
  allEquipment: EquipmentLookup[]
}) {
  const [channelName, setChannelName] = useState(strand.channelName)
  const [attachedId, setAttachedId] = useState<number | null>(strand.attachedEquipmentId)
  const [, startTransition] = useTransition()
  const color = strandColor(hwType, strand.index)

  function commitChannelName() {
    if (channelName === strand.channelName) return
    startTransition(async () => {
      await updateMultStrand(projectId, strand.id, { channelName })
    })
  }

  function commitAttach(next: number | null) {
    setAttachedId(next)
    startTransition(async () => {
      await updateMultStrand(projectId, strand.id, { attachedEquipmentId: next })
    })
  }

  // Pre-pend the currently-attached row to the dropdown options even
  // though the 1:1 attach filter excludes it — otherwise the displayed
  // selection would render blank.
  const currentAttached = attachedId
    ? allEquipment.find((e) => e.id === attachedId) ?? null
    : null
  const dropdownOptions = currentAttached
    ? [currentAttached, ...attachOptions.filter((e) => e.id !== currentAttached.id)]
    : attachOptions

  // Build labelled options for the attach dropdown. Switches show their
  // location next to the SW N ID; antennas show their free-form "Name"
  // (position field) next to the ANT N ID. Same `·` separator as the
  // row headers so picks read consistently with the cards.
  const attachOptionList = [
    { value: '', label: '—' },
    ...dropdownOptions.map((e) => {
      const suffix = e.category === 'switches'
        ? e.location
        : e.category === 'antennas'
          ? e.position
          : null
      return {
        value: String(e.id),
        label: suffix ? `${e.name} · ${suffix}` : e.name,
      }
    }),
  ]

  return (
    // Mobile: two-row layout — color chip + channel input on row 1,
    // attach dropdown full-width on row 2, with a bottom border to
    // separate each strand entry. Desktop: everything inline on one
    // row, no extra separator (the parent group spacing handles it).
    <div className="flex flex-col gap-2 border-b border-white/[0.04] pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:gap-2 sm:border-b-0 sm:pb-0">
      <div className="flex items-center gap-2 sm:flex-1">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${color.tw} ${color.tw.includes('bg-gray-100') || color.tw.includes('bg-yellow-400') || color.tw.includes('bg-cyan-300') || color.tw.includes('bg-orange-500') || color.tw.includes('bg-pink-400') ? 'text-black' : 'text-white'}`}
          title={color.label}
        >
          {strand.index}
        </span>
        <input
          type="text"
          value={channelName}
          onChange={(e) => setChannelName(e.target.value)}
          onBlur={commitChannelName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.currentTarget as HTMLInputElement).blur()
            }
          }}
          placeholder={isAttachable ? 'Channel name' : 'Label'}
          className="flex-1 rounded-lg border border-white/10 bg-[#202020] px-3 py-1.5 text-xs text-gray-200 outline-none transition-colors hover:border-white/20 focus:border-[#0178a3]"
        />
      </div>
      {isAttachable && (
        <div className="w-full sm:w-56 sm:shrink-0">
          <SearchableSelect
            compact
            value={attachedId == null ? '' : String(attachedId)}
            placeholder="Attach to..."
            options={attachOptionList}
            onChange={(v) => commitAttach(v ? parseInt(v, 10) : null)}
          />
        </div>
      )}
    </div>
  )
}
