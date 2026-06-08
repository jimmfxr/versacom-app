'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { ProjectSwitcher } from '@/app/project-dashboard'
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
  project,
  userProjects,
  equipment,
  ports: initialPorts,
  profiles,
  canEdit,
}: {
  project: { id: number; name: string }
  userProjects: Array<{ id: number; name: string }>
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
        projectId: project.id,
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
      {/* ─── Page header ───
          'Comms' as the page-level title (same chrome as the Project
          Detail / Equipment page operators are coming from), Close
          button + ProjectSwitcher on the right. The switch identity
          (name · model · port count) lives BELOW the border, not
          inside the header — matches what the operator asked for
          and mirrors how Panel Studio puts the user identity strip
          under its own page header. */}
      <header className="flex flex-row items-center justify-between gap-3 border-b-2 border-white/20 pb-4">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white truncate">
          Comms
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => router.push(`/projects/${project.id}?tab=equipment`)}
            style={{ touchAction: 'manipulation' }}
            className="inline-flex rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
          >
            Close
          </button>
          <div className="w-[calc(50vw-1rem)] sm:w-auto">
            <ProjectSwitcher
              projectId={project.id}
              projectName={project.name}
              userProjects={userProjects}
              basePath="/projects/:id"
            />
          </div>
        </div>
      </header>

      {/* Switch identity strip — name + model + port count, lives
          under the page header border. Centered on the page so the
          operator's eye lands here before the chassis below. */}
      <div className="flex flex-col items-center gap-1 pt-4 sm:pt-6">
        <div className="text-xl font-semibold text-white">{equipment.name}</div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="text-gray-300">{equipment.modelLabel}</span>
          <span className="text-gray-600">·</span>
          <span>{equipment.rj45Count + equipment.sfpCount} ports</span>
        </div>
      </div>

      {/* Chassis — flex-1 vertically centers it on tall viewports.
          Padding gives the chassis breathing room on both axes; on
          large displays the chassis hovers in the middle of the
          workspace like Panel Studio's panel. The flex layout
          horizontally centers the chassis at all viewport widths
          (text-align-based mx-auto wasn't reliable on inline-block). */}
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
      {/* Horizontal scroll container — flex justify-center centers
          the chassis when it fits, falls back to natural left-
          aligned scroll when the chassis is wider than the viewport
          (e.g. a 40-port switch on mobile). The flex wrapper is
          what actually centers — the chassis itself is inline-block
          so mx-auto wouldn't work. */}
      <div className="flex justify-center overflow-x-auto pb-2">
        <div
          // Chassis bezel — matches Panel Studio's panel-chassis chrome
          // (bg-[#2a2a2a] · border-white/[0.06] · rounded-[14px] ·
          // padded) so the two studios read as siblings.
          className="inline-block shrink-0 rounded-[14px] border border-white/[0.06] bg-[#2a2a2a] p-6 sm:p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          <div
            className="grid gap-2"
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
  // All ports share the same 48x48 (size-12) cell — operator wanted
  // them uniform. SFP and RJ45 were previously differentiated by
  // aspect (SFP slimmer w-10 vs RJ45 w-12) to mirror the physical
  // chassis, but the size mismatch read as "broken" rather than
  // "two port banks." Keeping uniform; the bank break is still
  // implied by the index gap (1..rj45Count = RJ45 row, then SFP).
  const aspectClass = 'h-12 w-12'
  // Anchor for the portaled popover. Measured on open via
  // getBoundingClientRect so the popover sits below the cell even
  // when the chassis is inside an overflow-x-auto scroll container
  // (which would otherwise clip a same-DOM absolutely-positioned
  // popover).
  const cellRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="relative" style={style}>
      <button
        ref={cellRef}
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
        className={`relative ${aspectClass} flex flex-col items-center justify-start gap-0.5 rounded-md border border-white/10 pt-1.5 text-xs font-bold transition-transform ${
          fillColor === 'transparent' ? 'bg-[#1a1a1a]' : ''
        } ${canEdit ? 'cursor-pointer active:scale-95' : 'cursor-default'} ${
          isOpen ? 'outline outline-2 outline-[#22a7d3]' : ''
        }`}
      >
        <span className={`${portNumberColor} leading-none`}>{port.portIndex}</span>
        {port.isTrunk && (
          // White-circle "T" badge bottom-right, mirroring NETGEAR
          // ProAV Engage's trunk indicator. Scaled with the larger
          // cell so the badge still reads proportional.
          <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-white text-[9px] font-extrabold text-black shadow-sm">
            T
          </span>
        )}
      </button>

      {/* Popover renders via createPortal to escape the chassis's
          overflow-x-auto scroller (which was clipping the popover
          for cells near the chassis edge). Position is computed
          from the cell's bounding rect on open. */}
      {isOpen && canEdit && (
        <PortEditPopover
          port={port}
          profile={profile}
          profiles={profiles}
          onPatch={onPatch}
          onClose={onClose}
          anchorRef={cellRef}
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
  profile: _profile,
  profiles,
  onPatch,
  onClose,
  anchorRef,
}: {
  port: Port
  profile: Profile | null
  profiles: Profile[]
  onPatch: (next: { profileId: number | null; isTrunk: boolean }) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
}) {
  // Group profiles by type for the section headers. Map preserves
  // insertion order, which already matches sortOrder from the DB.
  const grouped = new Map<string, Profile[]>()
  for (const p of profiles) {
    const arr = grouped.get(p.profileType) ?? []
    arr.push(p)
    grouped.set(p.profileType, arr)
  }

  // Position the popover anchored to the cell. Measured via
  // getBoundingClientRect on mount + re-measured on viewport
  // scroll/resize so the popover stays glued to the cell if the
  // chassis horizontal-scrolls underneath it. Clamped to viewport
  // edges so the popover never spills off-screen for the leftmost
  // / rightmost ports.
  const POPOVER_WIDTH = 288 // matches w-72
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    function update() {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2
      // Clamp so the popover never spills past the viewport edge —
      // important for port 1 (leftmost) and the last SFP port
      // (rightmost) on a chassis that's wider than the viewport.
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

  if (typeof document === 'undefined' || !pos) return null
  return createPortal(
    <>
      {/* Click-outside backdrop — full-viewport transparent overlay
          that closes the popover on tap. Below the popover's z-index
          so the popover itself stays interactive. */}
      <div className="fixed inset-0 z-[100]" onClick={onClose} />
      <div
        style={{ position: 'fixed', left: pos.left, top: pos.top, width: POPOVER_WIDTH }}
        className="z-[110] overflow-hidden rounded-lg border-2 border-white/10 bg-[#2a2a2a] shadow-2xl"
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
    </>,
    document.body,
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
