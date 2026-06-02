'use client'

import { type ReactNode } from 'react'

/**
 * Single-task focus mode for inline Add / Edit cards.
 *
 * Pass the focused content (your Add form) as `focused` and the
 * normal content (your list + empty state) as `children`. When
 * `open` is true the focused content renders by itself; when false
 * the children render and the focused content stays unmounted.
 *
 * Pattern adopted across Comms / Radios / Projects so every
 * "+ Add X" or inline edit gives the operator a single-task surface
 * with no underlying list rows competing for attention. The tab
 * toolbar / page header live OUTSIDE this wrapper and stay visible
 * either way, so the operator can still tell where they are.
 *
 * Mirrors the behavior the Racks tab Edit card had from day one
 * (see PD-024). This component is the shared abstraction so every
 * surface behaves the same way without each callsite reinventing
 * the conditional.
 *
 * Usage:
 *   <FocusMode open={showAddRack} focused={<CreateRackForm ... />}>
 *     <RackList ... />
 *   </FocusMode>
 */
export function FocusMode({
  open,
  focused,
  children,
}: {
  open: boolean
  /** Add / Edit card rendered when `open` is true. */
  focused: ReactNode
  /** Normal content (list, empty state, etc.) shown when
   *  `open` is false. */
  children: ReactNode
}) {
  return <>{open ? focused : children}</>
}
