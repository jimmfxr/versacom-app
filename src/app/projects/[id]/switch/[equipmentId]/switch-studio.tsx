'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { updateSwitchPort } from './actions'

/**
 * Switch Studio — chassis visualization for a NETGEAR M4250-family
 * switch with click-to-edit VLAN profile assignment per port.
 *
 * Layout
 * - Header: model label · switch name · X close (same chrome as Rack
 *   Preview, with the cyan-active icon button language).
 * - Chassis: two-row port grid (odd top, even bottom — NETGEAR
 *   convention). RJ45 cells render first (1..rj45Count), then SFP
 *   cells continue. Each cell is filled with its VLAN profile's
 *   color; trunk ports render gray with a small white "T" badge.
 *   Clicking a cell opens an inline popover anchored to it with the
 *   profile picker.
 *
 * Port-edit flow
 * - Tap a port → popover with profiles grouped by type (Data / Audio
 *   Dante / Audio AES67) + a "Trunk" toggle + an "Unassign" row.
 * - Picking a profile or toggling Trunk fires updateSwitchPort()
 *   server action; the client optimistically updates so the cell
 *   color changes instantly. router.refresh() pulls fresh state on
 *   success.
 * - Manager + user role land on canEdit=false → cells are decorative,
 *   no popover, X close is the only interaction.
 */

type Port = {
  id: number
  portIndex: number
  portKind: 'rj45' | 'sfp'
  profileId: number | null
  isTrunk: boolean
}

type Profile = {
  id: number
  name: string
  vlanId: number
  color: string
  profileType: string
  description: string | null
}

export function SwitchStudio({
  projectId,
  equipment,
  ports: initialPorts,
  profiles,
  canEdit,
}: {
  projectId: number
  equipment: {
    id: number
    name: string
    modelLabel: string
    rj45Count: number
    sfpCount: number
  }
  ports: Port[]
  profiles: Profile[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [ports, setPorts] = useState(initialPorts)
  const [openPortId, setOpenPortId] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  const profileById = new Map(profiles.map((p) => [p.id, p]))
  const managementProfile = profiles.find((p) => p.name === 'Management')

  // Patch a single port locally + on the server. Optimistic — the
  // cell color updates before the round-trip lands so the operator
  // gets immediate feedback. router.refresh() on success pulls in
  // any normalization the server applied.
  function patchPort(port: Port, next: { profileId: number | null; isTrunk: boolean }) {
    setPorts((prev) => prev.map((p) => (p.id === port.id ? { ...p, ...next } : p)))
    startTransition(async () => {
      const result = await updateSwitchPort({
        projectId,
        equipmentId: equipment.id,
        portId: port.id,
        profileId: next.profileId,
        isTrunk: next.isTrunk,
      })
      if ('error' in result) {
        // Roll back on server error — operator should retry.
        setPorts((prev) => prev.map((p) => (p.id === port.id ? port : p)))
      } else {
        router.refresh()
      }
    })
  }

  return (
    <>
      {/* Header — model label · switch name · X close. Chrome matches
          Rack Preview: name on the left, single naked icon button on
          the right with the cyan press-feedback the rest of the rack-
          studio nav icons use. */}
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-white truncate">{equipment.modelLabel}</span>
          <span className="text-sm text-gray-600">·</span>
          <span className="text-sm text-[#22a7d3] truncate">{equipment.name}</span>
        </div>
        <Link
          href={`/projects/${projectId}?tab=equipment`}
          aria-label="Close switch studio"
          style={{ touchAction: 'manipulation' }}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-white active:bg-[#0178a3] active:text-white"
        >
          <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </Link>
      </header>

      {/* Chassis — flex-1 vertically centers it on tall viewports.
          The chassis itself is one wide panel with the two-row port
          grid inside. */}
      <div className="flex flex-1 items-center justify-center py-8">
        <Chassis
          rj45Count={equipment.rj45Count}
          sfpCount={equipment.sfpCount}
          ports={ports}
          profileById={profileById}
          managementColor={managementProfile?.color ?? '#808080'}
          canEdit={canEdit}
          openPortId={openPortId}
          onOpenPort={(id) => canEdit && setOpenPortId((cur) => (cur === id ? null : id))}
          onClosePort={() => setOpenPortId(null)}
          onPatch={patchPort}
          profiles={profiles}
        />
      </div>
    </>
  )
}

/**
 * Two-row chassis grid. RJ45 cells fill columns 1..rj45Count then SFP
 * cells continue rj45Count+1..total. Within each column the odd-
 * numbered port sits on top, even on bottom — matches NETGEAR's
 * physical numbering on the chassis face.
 */
function Chassis({
  rj45Count,
  sfpCount,
  ports,
  profileById,
  managementColor,
  canEdit,
  openPortId,
  onOpenPort,
  onClosePort,
  onPatch,
  profiles,
}: {
  rj45Count: number
  sfpCount: number
  ports: Port[]
  profileById: Map<number, Profile>
  managementColor: string
  canEdit: boolean
  openPortId: number | null
  onOpenPort: (id: number) => void
  onClosePort: () => void
  onPatch: (port: Port, next: { profileId: number | null; isTrunk: boolean }) => void
  profiles: Profile[]
}) {
  const portByIndex = new Map(ports.map((p) => [p.portIndex, p]))
  const totalCount = rj45Count + sfpCount
  // Column count = ceil(total/2) so the grid is symmetric across two
  // rows. Port columns: column 1 holds ports 1 (top) + 2 (bottom),
  // column 2 holds 3 + 4, etc.
  const columnCount = Math.ceil(totalCount / 2)

  return (
    <div className="relative w-full">
      <div className="overflow-x-auto pb-2">
        <div
          // Chassis bezel — dark frame around the port grid mirrors
          // the actual NETGEAR M4250 chassis chrome.
          className="mx-auto inline-block rounded-lg border border-white/10 bg-[#0a0a0a] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          <div
            className="grid gap-1.5"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              gridAutoRows: 'auto',
            }}
          >
            {/* Two rows × columnCount columns. Each cell positioned
                via gridRow/gridColumn so odd ports always top, even
                always bottom regardless of RJ45/SFP breakpoint. */}
            {Array.from({ length: totalCount }, (_, i) => {
              const portIndex = i + 1
              const port = portByIndex.get(portIndex)
              if (!port) return null
              const col = Math.ceil(portIndex / 2)
              const row = portIndex % 2 === 1 ? 1 : 2
              return (
                <PortCell
                  key={port.id}
                  port={port}
                  profile={port.profileId != null ? profileById.get(port.profileId) ?? null : null}
                  managementColor={managementColor}
                  canEdit={canEdit}
                  isOpen={openPortId === port.id}
                  onOpen={() => onOpenPort(port.id)}
                  onClose={onClosePort}
                  onPatch={(next) => onPatch(port, next)}
                  profiles={profiles}
                  style={{ gridColumn: col, gridRow: row }}
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
 * One port cell — colored rectangle with the port number on top and
 * (for trunks) a small white circular "T" badge bottom-right. RJ45
 * cells are square-ish, SFP cells slightly slimmer to mirror the
 * physical port aspect on the chassis.
 *
 * Click target — when canEdit + clicked, opens an inline popover
 * with the profile picker. The popover is absolutely positioned and
 * uses the port's grid coordinates as anchor.
 */
function PortCell({
  port,
  profile,
  managementColor,
  canEdit,
  isOpen,
  onOpen,
  onClose,
  onPatch,
  profiles,
  style,
}: {
  port: Port
  profile: Profile | null
  managementColor: string
  canEdit: boolean
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  onPatch: (next: { profileId: number | null; isTrunk: boolean }) => void
  profiles: Profile[]
  style: React.CSSProperties
}) {
  // Trunk ports always render gray (Management color) regardless of
  // which profile sits on them — matches NETGEAR ProAV Engage. The
  // underlying profileId is preserved for round-tripping.
  const fillColor = port.isTrunk
    ? managementColor
    : profile?.color ?? 'transparent'
  // White text on dark fills, black on light. Threshold based on
  // simple luma — light yellows / cyans / whites get black text so
  // the port number stays legible.
  const textOnLight = profile && isLightColor(fillColor)
  const portNumberColor = port.isTrunk || !profile
    ? 'text-gray-300'
    : textOnLight
      ? 'text-black'
      : 'text-white'
  // SFP cells render slightly slimmer (8:5 aspect) so the chassis
  // reads as two distinct port banks — RJ45 squares + SFP slim
  // rectangles. Matches the physical M4250 face.
  const aspectClass = port.portKind === 'sfp' ? 'h-9 w-8' : 'h-9 w-9'

  return (
    <div className="relative" style={style}>
      <button
        type="button"
        onClick={() => canEdit && onOpen()}
        disabled={!canEdit}
        aria-label={`Port ${port.portIndex} — ${
          port.isTrunk ? 'Trunk' : profile?.name ?? 'Unassigned'
        }`}
        title={
          port.isTrunk
            ? `Port ${port.portIndex} · Trunk`
            : profile
              ? `Port ${port.portIndex} · ${profile.name} (VLAN ${profile.vlanId})`
              : `Port ${port.portIndex} · Unassigned`
        }
        style={{
          backgroundColor: fillColor === 'transparent' ? undefined : fillColor,
        }}
        className={`relative ${aspectClass} flex flex-col items-center justify-start gap-0.5 rounded-md border border-white/10 pt-1 text-[10px] font-bold transition-transform ${
          fillColor === 'transparent' ? 'bg-[#1a1a1a]' : ''
        } ${canEdit ? 'cursor-pointer active:scale-95' : 'cursor-default'} ${
          isOpen ? 'outline outline-2 outline-[#22a7d3]' : ''
        }`}
      >
        <span className={`${portNumberColor} leading-none`}>{port.portIndex}</span>
        {port.isTrunk && (
          // White-circle "T" badge bottom-right, mirroring NETGEAR
          // ProAV Engage's trunk indicator. size-3 keeps it visually
          // proportional to the size-9 cell.
          <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-white text-[7px] font-extrabold text-black shadow-sm">
            T
          </span>
        )}
      </button>

      {/* Popover — absolutely positioned below the cell. z-50 so it
          rides above sibling port cells. */}
      {isOpen && canEdit && (
        <PortEditPopover
          port={port}
          profile={profile}
          profiles={profiles}
          onPatch={onPatch}
          onClose={onClose}
        />
      )}
    </div>
  )
}

/**
 * Profile picker popover that drops in below the clicked port cell.
 * Groups profiles by profileType (Data / Audio Dante / Audio AES67).
 * Each row shows the VLAN color swatch, profile name, VLAN ID, and a
 * one-line description. "Unassigned" row at the top clears the
 * port's profile. "Trunk" checkbox at the bottom toggles isTrunk.
 *
 * Closes on outside click (rendered as a backdrop) + Escape. Picking
 * a profile or toggling trunk does NOT close — operator can keep
 * iterating until they navigate away or click another port.
 */
function PortEditPopover({
  port,
  profile,
  profiles,
  onPatch,
  onClose,
}: {
  port: Port
  profile: Profile | null
  profiles: Profile[]
  onPatch: (next: { profileId: number | null; isTrunk: boolean }) => void
  onClose: () => void
}) {
  // Group profiles by type for the section headers. Map preserves
  // insertion order, which already matches sortOrder from the DB.
  const grouped = new Map<string, Profile[]>()
  for (const p of profiles) {
    const arr = grouped.get(p.profileType) ?? []
    arr.push(p)
    grouped.set(p.profileType, arr)
  }

  return (
    <>
      {/* Click-outside backdrop — full-viewport transparent overlay
          that closes the popover on tap. Below the popover's z-index
          so the popover itself stays interactive. */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 overflow-hidden rounded-lg border-2 border-white/10 bg-[#2a2a2a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Port ${port.portIndex} VLAN picker`}
      >
        <div className="max-h-72 overflow-y-auto">
          {/* Unassigned row at the top — null profile / non-trunk. */}
          <button
            type="button"
            onClick={() => onPatch({ profileId: null, isTrunk: false })}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.04] ${
              port.profileId == null && !port.isTrunk ? 'bg-white/[0.06]' : ''
            }`}
          >
            <span className="size-4 shrink-0 rounded border border-dashed border-white/30" />
            <span className="flex-1 truncate text-gray-300">Unassigned</span>
          </button>

          {[...grouped.entries()].map(([type, list]) => (
            <div key={type}>
              <div className="border-t border-white/[0.06] px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                {type}
              </div>
              {list.map((p) => {
                const selected = port.profileId === p.id && !port.isTrunk
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onPatch({ profileId: p.id, isTrunk: false })}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.04] ${
                      selected ? 'bg-white/[0.06]' : ''
                    }`}
                  >
                    <span
                      style={{ backgroundColor: p.color }}
                      className="size-4 shrink-0 rounded border border-white/10"
                    />
                    <span className="min-w-0 flex-1 flex items-baseline gap-2">
                      <span className="truncate text-white">{p.name}</span>
                      <span className="shrink-0 text-[10px] font-mono text-gray-500">v{p.vlanId}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Trunk toggle — bottom of the popover. Flips isTrunk in
            place; profileId stays as it is, so flipping off the trunk
            falls back to the previously-selected profile. */}
        <div className="border-t-2 border-white/10 px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={port.isTrunk}
              onChange={(e) => onPatch({ profileId: port.profileId, isTrunk: e.target.checked })}
              className="size-4 rounded border-white/20 bg-[#202020] text-[#0178a3] focus:ring-[#0178a3]"
            />
            <span>Trunk port</span>
            <span className="ml-auto text-[10px] text-gray-500">
              {port.isTrunk ? 'Renders gray + T' : 'Untagged on the selected VLAN'}
            </span>
          </label>
        </div>
      </div>
    </>
  )
}

/** Rough luminance check — true when the color is light enough that
 *  black text reads better than white. Used by PortCell to pick the
 *  port-number color so light VLAN swatches (white / pale yellow /
 *  cyan) don't render unreadable white-on-white. */
function isLightColor(hex: string): boolean {
  if (!hex.startsWith('#') || hex.length !== 7) return false
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  // ITU-R BT.601 luma — close enough for "is this background light"
  // without a full WCAG contrast computation.
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  return luma > 160
}
