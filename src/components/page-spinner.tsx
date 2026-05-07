/**
 * Full-viewport loading placeholder used by Next.js route segments
 * (loading.tsx files). Renders a centered cyan spinner on the same
 * #202020 background as AppShell so route transitions stay visually
 * continuous instead of flashing the body's default white.
 */
export function PageSpinner() {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center bg-[#202020]">
      <svg
        className="size-12 animate-spin text-[#22a7d3]"
        viewBox="0 0 24 24"
        fill="none"
        aria-label="Loading"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="3"
        />
        <path
          d="M22 12A10 10 0 0 0 12 2"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}
