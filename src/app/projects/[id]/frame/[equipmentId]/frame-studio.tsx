'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { ProjectSwitcher } from '@/app/project-dashboard'
import { AutoHideHeader } from '@/components/auto-hide-header'
import {
  FRAME_MODELS,
  getCardLabel,
  getCardShortLabel,
  type CardType,
  type FrameBay,
  type FrameModel,
} from '@/lib/frame-models'
import { updateFrameSlot } from './actions'

/**
 * Frame Studio — chassis visualization for a Riedel Artist frame
 * (Artist 32 / MRF 64 / MFR 128 / Artist 1024) with click-to-edit
 * card-type assignment per bay.
 *
 * Mirrors Switch Studio at the chrome layer (Comms header in
 * AutoHideHeader, identity strip that wraps to 2 rows on mobile,
 * labeled Close button) so the two surfaces feel like siblings. The
 * domain-specific bits — bay grid layout, allowed-card whitelist,
 * lazy-seed defaults — live in src/lib/frame-models.ts.
 *
 * Per the operator: no card colors, plain text labels in each cell;
 * Fan / PSU / SyncModule chrome NOT rendered (editable bays only);
 * MFR 128 shows the front view of the chassis (rear view is hidden);
 * each frame model uses its own orientation (1024 horizontal,
 * 32/64 vertical, 128 wider grid).
 */

type Slot = {
  id: number
  bayKey: string
  cardType: string
  notes: string | null
}

export function FrameStudio({
  project,
  userProjects,
  equipment,
  slots: initialSlots,
  canEdit,
}: {
  project: { id: number; name: string }
  userProjects: Array<{ id: number; name: string }>
  equipment: {
    id: number
    name: string
    /** Display label from the FrameModel — e.g. "Artist 1024". */
    modelLabel: string
    /** Equipment.hardwareType, used to resolve the FrameModel on the
     *  client (the chassis grid is rendered from the same model the
     *  server seeded with). */
    modelKey: string
    /** Equipment.ipAddress — cyan link in the identity strip, opens
     *  http://IP in a new tab (same as Switch Studio's IP link). */
    ipAddress: string | null
    /** Equipment.frameNodeId — the Riedel-side identifier the frame
     *  is programmed with. Rendered alongside the IP in the identity
     *  strip + on the Equipment card. */
    frameNodeId: string | null
    bayCount: number
  }
  slots: Slot[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [slots, setSlots] = useState(initialSlots)
  const [openSlotId, setOpenSlotId] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  const model = FRAME_MODELS[equipment.modelKey]
  // Defensive — page.tsx 404s when the model is unregistered, but the
  // client gets the modelKey via props so a stale build could in
  // theory mismatch. Render a clear error rather than crashing.
  if (!model) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-400">
        Frame model not registered for hardware type {equipment.modelKey}.
      </div>
    )
  }

  // Patch a single slot locally + on the server. Optimistic — the cell
  // updates before the server round-trip lands so the operator gets
  // immediate feedback. router.refresh() on success pulls in any
  // server-side normalization.
  function patchSlot(slot: Slot, next: { cardType: string }) {
    setSlots((prev) => prev.map((s) => (s.id === slot.id ? { ...s, ...next } : s)))
    startTransition(async () => {
      const result = await updateFrameSlot({
        projectId: project.id,
        equipmentId: equipment.id,
        slotId: slot.id,
        cardType: next.cardType,
      })
      if ('error' in result) {
        // Roll back on server error — operator should retry.
        setSlots((prev) => prev.map((s) => (s.id === slot.id ? slot : s)))
      } else {
        router.refresh()
      }
    })
  }

  return (
    <>
      {/* ─── Page header ───
          Same chrome as Switch Studio: 'Comms' as the page-level
          title, ProjectSwitcher to the right, bottom border, wrapped
          in AutoHideHeader so it slides up on scroll-down on mobile. */}
      <AutoHideHeader>
        <header className="flex flex-row items-center justify-between gap-3 border-b-2 border-white/20 pb-4">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white truncate">
            Comms
          </h1>
          <div className="w-[calc(50vw-1rem)] sm:w-auto shrink-0">
            <ProjectSwitcher
              projectId={project.id}
              projectName={project.name}
              userProjects={userProjects}
              basePath="/projects/:id"
            />
          </div>
        </header>
      </AutoHideHeader>

      {/* Frame identity strip — name · model on row 1, IP · Node ·
          bay count on row 2 (mobile) / single-row (desktop). Same
          forced-wrap pattern as Switch Studio: flex-wrap on the
          identity group plus a mobile-only basis-full sm:hidden
          break element. Close button is a sibling outside the wrap
          group so the outer justify-between always pins it right. */}
      {/* Frame identity strip — matches Panel Studio's two-row
          pattern (panel-studio.tsx ~line 2128) for consistency
          across the three studios. Row 1 = FRM N in cyan font-
          mono. Row 2 = IP · Node ID · bay count in smaller text
          with Panel-Studio gray-600 ('#3a3a3a') separator dots.
          Close button pinned top-right via items-start on the
          outer flex. */}
      <div className="flex items-start justify-between gap-3 pt-4 sm:pt-6">
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-bold text-[#22a7d3] font-mono lg:text-[22px]">
            {equipment.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {equipment.ipAddress && (
              <>
                <a
                  href={`http://${equipment.ipAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[13px] text-[#22a7d3] hover:text-[#019bc7]"
                >
                  {equipment.ipAddress}
                </a>
                <span className="text-xs text-[#3a3a3a]">·</span>
              </>
            )}
            {equipment.frameNodeId && (
              <>
                <span className="text-[13px] text-gray-400">
                  Node <span className="text-white">{equipment.frameNodeId}</span>
                </span>
                <span className="text-xs text-[#3a3a3a]">·</span>
              </>
            )}
            <span className="text-[13px] text-gray-500">{equipment.bayCount} bays</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/projects/${project.id}?tab=equipment`)}
          style={{ touchAction: 'manipulation' }}
          className="shrink-0 inline-flex rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
        >
          Close
        </button>
      </div>

      {/* Chassis — vertically centered on tall viewports, breathing
          room on both axes, horizontal scroll if the model's column
          count blows past the viewport. */}
      <div className="flex flex-1 items-center justify-center py-8">
        <Chassis
          model={model}
          slots={slots}
          canEdit={canEdit}
          openSlotId={openSlotId}
          onOpenSlot={(id) => canEdit && setOpenSlotId((cur) => (cur === id ? null : id))}
          onCloseSlot={() => setOpenSlotId(null)}
          onPatch={patchSlot}
        />
      </div>
    </>
  )
}

/**
 * Chassis grid. Reads `cols` + `rows` from the FrameModel and places
 * each cell via its `bay.column` + `bay.row`. Inline styled grid
 * because Tailwind v4 wouldn't reliably emit dynamic grid-template-
 * columns/rows utilities for arbitrary counts (same workaround used
 * in Switch Studio).
 *
 * Mobile scroll behavior: mx-auto w-fit block inside an
 * overflow-x-auto wrapper — chassis centers when it fits the
 * viewport, anchors LEFT when it overflows so the scroll can reach
 * the rightmost columns AND the leftmost (PD-031 pattern).
 */
function Chassis({
  model,
  slots,
  canEdit,
  openSlotId,
  onOpenSlot,
  onCloseSlot,
  onPatch,
}: {
  model: FrameModel
  slots: Slot[]
  canEdit: boolean
  openSlotId: number | null
  onOpenSlot: (id: number) => void
  onCloseSlot: () => void
  onPatch: (slot: Slot, next: { cardType: string }) => void
}) {
  // Map slots by bayKey so the chassis layout (driven by FrameModel)
  // can look them up directly. A missing slot for any bayKey means
  // lazy-seed hasn't run — the page loader handles that, so we'd
  // only see misses in an inconsistent intermediate state.
  const slotByBayKey = new Map(slots.map((s) => [s.bayKey, s]))

  return (
    <div className="relative w-full">
      <div className="overflow-x-auto pb-2">
        <div className="relative mx-auto w-fit rounded-[14px] border border-white/[0.06] bg-[#2a2a2a] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {/* Chassis-printed model label — same treatment Panel
              Studio uses on its panel-chassis card so the three
              studios read uniform. Absolute-positioned in the
              top-right of the bezel's padding band so it takes
              zero vertical space and the bay grid below sits at
              its natural position. text-sm + tracking-[0.18em] +
              tabular-nums = engraved-silkscreen plate look (vs.
              the smaller flex-row label I had before). */}
          <div className="pointer-events-none absolute right-4 top-3 text-sm font-bold uppercase tracking-[0.18em] tabular-nums leading-none text-[#22a7d3]">
            {model.label}
          </div>
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${model.cols}, auto)`,
              gridTemplateRows: `repeat(${model.rows}, auto)`,
            }}
          >
            {model.bays.map((bay) => {
              const slot = slotByBayKey.get(bay.key)
              if (!slot) return null
              return (
                <BayCell
                  key={slot.id}
                  bay={bay}
                  slot={slot}
                  model={model}
                  canEdit={canEdit}
                  isOpen={openSlotId === slot.id}
                  onOpen={() => onOpenSlot(slot.id)}
                  onClose={onCloseSlot}
                  onPatch={(next) => onPatch(slot, next)}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * One bay cell — fixed 80×64 (wider than tall to fit the card-type
 * label legibly). Bay key small at the top, card shortLabel centered.
 * Accent border for the red CPU/GPI/specialty bays so the operator
 * sees the chassis-printed grouping at a glance.
 *
 * Clicking opens a portaled popover (same technique as Switch Studio's
 * port edit) with the bay's allowedCards list.
 */
function BayCell({
  bay,
  slot,
  model,
  canEdit,
  isOpen,
  onOpen,
  onClose,
  onPatch,
}: {
  bay: FrameBay
  slot: Slot
  /** Owning frame model — passed down so the popover can pick the
   *  right card-label convention (full -108 G2 names for older
   *  frames, short names for the 1024). */
  model: FrameModel
  canEdit: boolean
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  onPatch: (next: { cardType: string }) => void
}) {
  const cellRef = useRef<HTMLButtonElement>(null)
  // Operator decision PD-035: no per-card colors. Cells are uniform
  // neutral background; current card type is shown as plain text. The
  // red accent on Bay A/B/X/Y bays just gets a thin border tint so the
  // operator can read the chassis-printed grouping.
  const baseBg = 'bg-[#1f1f1f]'
  const accentBorder =
    bay.accent === 'red'
      ? 'border-[#5a1818]'
      : 'border-white/10'

  return (
    <div className="relative" style={{ gridColumn: bay.column, gridRow: bay.row }}>
      <button
        ref={cellRef}
        type="button"
        onClick={() => canEdit && onOpen()}
        disabled={!canEdit}
        aria-label={`Bay ${bay.key} — ${getCardLabel(slot.cardType)}`}
        title={`Bay ${bay.key} · ${getCardLabel(slot.cardType)}`}
        // Wider cells so each bay reads like a horizontal Riedel card
        // module — h-14 (56px) × w-36 (144px) is roughly a 2.5:1
        // landscape rectangle, matching how the physical bays look on
        // the Artist chassis. Previous h-16 w-20 (4:5 portrait) read
        // too much like NETGEAR Switch Studio's port-key cells.
        className={`relative flex h-14 w-36 flex-col items-center justify-between rounded-md border ${accentBorder} ${baseBg} px-3 py-1.5 text-xs font-bold transition-transform ${
          canEdit ? 'cursor-pointer active:scale-95' : 'cursor-default'
        } ${isOpen ? 'outline outline-2 outline-[#22a7d3]' : ''}`}
      >
        {/* Bay key at the top — same role as port number on the
            Switch Studio cell. */}
        <span className="text-[10px] leading-none text-gray-400">Bay {bay.key}</span>
        {/* Card type centered/lower — the dominant info. Unused shows
            an em-dash so the cell still has a stable height. */}
        <span
          className={`leading-none text-center ${
            slot.cardType === 'unused' ? 'text-gray-500' : 'text-white'
          }`}
        >
          {slot.cardType === 'unused' ? '—' : getCardShortLabel(slot.cardType)}
        </span>
      </button>

      {isOpen && canEdit && (
        <BayEditPopover
          bay={bay}
          slot={slot}
          model={model}
          onPatch={onPatch}
          onClose={onClose}
          anchorRef={cellRef}
        />
      )}
    </div>
  )
}

/**
 * Card-type picker popover that drops in below the clicked bay cell.
 * Shows only the bay's `allowedCards` (no need for grouping — the
 * lists are short, 2–9 entries depending on the bay type).
 *
 * Closes on outside click (rendered as a backdrop) + Escape. Picking a
 * card does NOT close — operator can keep iterating until they
 * navigate away or click another bay.
 */
function BayEditPopover({
  bay,
  slot,
  model,
  onPatch,
  onClose,
  anchorRef,
}: {
  bay: FrameBay
  slot: Slot
  /** Owning frame model — drives which card-label convention to use
   *  in the picker (short for 1024, long with -108 G2 for older
   *  frames). */
  model: FrameModel
  onPatch: (next: { cardType: string }) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
}) {
  // Position anchored to the cell — same getBoundingClientRect +
  // viewport-clamp pattern as Switch Studio's PortEditPopover.
  const POPOVER_WIDTH = 288
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    function update() {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2
      const maxLeft = window.innerWidth - POPOVER_WIDTH - 8
      left = Math.max(8, Math.min(left, maxLeft))
      const top = rect.bottom + 8
      setPos({ left, top })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchorRef])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined' || !pos) return null
  return createPortal(
    <>
      {/* Click-outside backdrop. */}
      <div className="fixed inset-0 z-[100]" onClick={onClose} />
      <div
        style={{ position: 'fixed', left: pos.left, top: pos.top, width: POPOVER_WIDTH }}
        className="z-[110] overflow-hidden rounded-lg border-2 border-white/10 bg-[#2a2a2a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Bay ${bay.key} card picker`}
      >
        <div className="border-b border-white/[0.06] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Bay {bay.key} · choose card
        </div>
        <div className="max-h-72 overflow-y-auto">
          {bay.allowedCards.map((card) => {
            const selected = slot.cardType === card
            return (
              <button
                key={card}
                type="button"
                // Picking a card patches AND closes the popover —
                // operator preference, no need to keep it open since
                // there's only one knob per bay (no trunk-flag-style
                // secondary control like Switch Studio has). The
                // dropdown closing on selection matches every other
                // dropdown in the app (FilterDropdown / Listbox).
                onClick={() => {
                  onPatch({ cardType: card })
                  onClose()
                }}
                // Selected row fills solid cyan (#0178a3) with white
                // text — matches FilterDropdown's data-selected style
                // + the nav-link active state across the app. Hover
                // gives a neutral light tint that doesn't compete.
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  selected
                    ? 'bg-[#0178a3] text-white'
                    : 'text-gray-200 hover:bg-white/[0.04]'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {getCardLabel(card as CardType, model)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </>,
    document.body,
  )
}
