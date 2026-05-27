/**
 * Custom navbar icons that don't have a direct Heroicons match.
 * Single-color via currentColor so they pick up the chip's gray /
 * white / cyan state automatically. Same 1.5px stroke + 24x24
 * viewBox as the Heroicons outline set so they sit visually
 * consistent with InboxIcon / FolderIcon / DeviceTabletIcon
 * (which we use from the @heroicons/react/24/outline package for
 * Tasks / Projects / My Equipment).
 */

type IconProps = {
  className?: string
  'aria-hidden'?: boolean
}

/** Dashboard — static progress spinner (open circle + arc on top). */
export function ProgressSpinnerIcon({ className = '', ...rest }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {/* Faded full circle so the arc reads as "progress" rather
          than a partial slice. */}
      <circle cx="12" cy="12" r="9" strokeOpacity="0.3" />
      {/* Bright arc on the top-right covering ~ a quarter turn. */}
      <path d="M21 12A9 9 0 0 0 12 3" />
    </svg>
  )
}

/** Comms — intercom headset (over-the-head band + ear cups + boom mic). */
export function IntercomHeadsetIcon({ className = '', ...rest }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {/* Headband — semicircular arc across the top. */}
      <path d="M4 13a8 8 0 0 1 16 0" />
      {/* Left ear cup — rounded rectangle below the band on the left. */}
      <rect x="3.5" y="13" width="3.5" height="5.5" rx="1.25" />
      {/* Right ear cup — rounded rectangle on the right. */}
      <rect x="17" y="13" width="3.5" height="5.5" rx="1.25" />
      {/* Boom mic — diagonal line + tiny mic capsule extending from
          the left ear cup toward the mouth area. */}
      <path d="M5.25 18.5L9 21" />
      <circle cx="9.5" cy="21.25" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Radios — walkie-talkie (handheld body + antenna stub + speaker grill + PTT). */
export function WalkieTalkieIcon({ className = '', ...rest }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {/* Antenna stub on the top-left of the body. */}
      <path d="M8 2.5v3.5" />
      {/* Main body — tall rounded rectangle. */}
      <rect x="6" y="6" width="9" height="15.5" rx="1.5" />
      {/* PTT button on the right side of the body. */}
      <rect x="15" y="9" width="2.5" height="3.5" rx="0.5" />
      {/* Speaker grill — three short horizontal lines near the top
          of the body. */}
      <path d="M8 9.5h5" />
      <path d="M8 11h5" />
      {/* Display area — separator line just below the speaker. */}
      <path d="M7.5 13.25h6" />
      {/* PTT/keypad spot — small dot lower on the face. */}
      <circle cx="10.5" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}
