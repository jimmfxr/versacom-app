/**
 * Loading fallback for the kiosk route. The kiosk strips the
 * AppShell navbar and runs full-screen, so there's nothing on
 * screen during the server render of the new page — the user
 * gets a flash of white before the kiosk appears. Render a
 * cyan spinner on the page bg so the transition feels smooth.
 */
export default function KioskLoading() {
  return (
    <div className="flex h-[100dvh] w-full items-center justify-center bg-[#202020]">
      <svg
        className="size-12 animate-spin text-[#22a7d3]"
        viewBox="0 0 24 24"
        fill="none"
        aria-label="Loading kiosk"
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
