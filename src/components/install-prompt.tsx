'use client'

import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Renders an "Install" button anywhere it's placed. Hides itself if the app
 * is already installed (running in standalone display mode).
 *
 * Click behaviour:
 *  - Chrome / Edge / Android: fires the captured `beforeinstallprompt` event
 *    so the user gets the native one-tap install dialog.
 *  - iOS Safari: opens a small modal with a labelled diagram of the Share
 *    button → "Add to Home Screen" because Apple does not expose any install
 *    API to web apps.
 *  - Browsers we can't help (iOS Chrome, Firefox, etc.): nothing renders.
 */
type Platform = 'native' | 'ios' | 'desktop-chrome' | 'manual'

export function InstallButton({ className = '' }: { className?: string }) {
  const [installed, setInstalled] = useState(false)
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [platform, setPlatform] = useState<Platform>('manual')

  useEffect(() => {
    if (typeof window === 'undefined') return

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) {
      setInstalled(true)
      return
    }

    const ua = window.navigator.userAgent
    const isIOS = /iPhone|iPad|iPod/i.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream
    const isIOSSafari = isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)
    const isMobile = isIOS || /Android/i.test(ua)
    const isChrome = /Chrome|CriOS|EdgA?/i.test(ua) && !/OPR|Opera/i.test(ua)

    if (isIOSSafari) {
      setPlatform('ios')
    } else if (!isMobile && isChrome) {
      // Desktop Chrome / Edge — beforeinstallprompt usually fires after engagement.
      // Until it does, show a helpful modal explaining the URL-bar install option.
      setPlatform('desktop-chrome')
    } else {
      setPlatform('manual')
    }

    // Listen for the native install prompt event regardless — it can fire on
    // any Chromium-based browser and lets us upgrade to a one-click install.
    const handler = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
      setPlatform('native')
    }
    const installedHandler = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', installedHandler)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  if (installed) return null

  async function handleClick() {
    // If the browser fired beforeinstallprompt at any point, prefer the native dialog.
    if (promptEvent) {
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      if (choice.outcome === 'accepted') setInstalled(true)
      setPromptEvent(null)
      return
    }
    // Otherwise show the platform-specific guide.
    setShowModal(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          className
            ? `${className} flex items-center gap-2`
            : 'inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/[0.08]'
        }
      >
        <svg className="size-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        <span>Install app</span>
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 sm:items-center"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl bg-[#2a2a2a] p-6 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-white">Install Nodal Control</h3>

            {platform === 'ios' && (
              <>
                <p className="mt-1 text-xs text-gray-400">
                  iOS doesn&apos;t allow one-tap install. Two quick steps:
                </p>
                <Steps>
                  <Step n={1}>
                    Tap the share icon
                    <span className="ml-1.5 inline-flex items-center justify-center align-text-bottom rounded bg-white/[0.10] p-1">
                      <svg className="size-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15M9 12l3 3m0 0l3-3m-3 3V2.25" />
                      </svg>
                    </span>
                    <span className="block text-[11px] text-gray-500">at the bottom of Safari</span>
                  </Step>
                  <Step n={2}>
                    Choose <span className="font-semibold text-white">&ldquo;Add to Home Screen&rdquo;</span>
                  </Step>
                </Steps>
              </>
            )}

            {platform === 'desktop-chrome' && (
              <>
                <p className="mt-1 text-xs text-gray-400">
                  In Chrome, the install option lives in the address bar.
                </p>
                <Steps>
                  <Step n={1}>
                    Look at the right side of the address bar for an install icon
                    <span className="ml-1.5 inline-flex items-center justify-center align-text-bottom rounded bg-white/[0.10] p-1">
                      <svg className="size-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                    </span>
                  </Step>
                  <Step n={2}>
                    Or open the <span className="font-semibold text-white">⋮</span> menu and pick{' '}
                    <span className="font-semibold text-white">Cast, save, and share → Install Nodal Control</span>
                  </Step>
                </Steps>
                <p className="mt-3 text-[11px] text-gray-500">
                  Tip: Chrome often unlocks one-click install after you&apos;ve interacted with the page for a few seconds. Try clicking around and reopening this dialog.
                </p>
              </>
            )}

            {platform === 'manual' && (
              <p className="mt-2 text-sm text-gray-300">
                This browser doesn&apos;t support installing web apps. Open Nodal in <span className="font-semibold text-white">Chrome, Edge, or Safari (iOS)</span> to install it as an app.
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="mt-6 w-full rounded-lg bg-[#0178a3] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7]"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function Steps({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 space-y-4">{children}</div>
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#0178a3] text-xs font-bold text-white">
        {n}
      </span>
      <div className="flex-1 text-sm text-gray-300">{children}</div>
    </div>
  )
}
