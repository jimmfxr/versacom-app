'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BrowserMultiFormatReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'
import { ComboboxInput } from '@/components/combobox-input'
import { usePersistentState } from '@/lib/use-persistent-state'
import {
  lookupRadioByBarcode,
  assignRadioFromScan,
  returnRadioByBarcode,
  type RadioScanLookup,
} from '../actions'

type TeamMember = {
  id: number
  firstName: string
  lastName: string
  department: string | null
  position: string | null
}

// Decoupled "known radio" shape mirroring lookupRadioByBarcode's
// payload for the auto-return / prompt branches. Kept local so this
// component doesn't have to import the Prisma type.
type KnownRadio = {
  id: number
  name: string
  firstName: string | null
  lastName: string | null
  department: string | null
  position: string | null
  barcode: string | null
  status: string
  assignedToProjectMemberId: number | null
  fistMic: boolean
  surveillance: boolean
  doubleMuff: boolean
  lightweight: boolean
  fistMicBarcode: string | null
  surveillanceBarcode: string | null
  doubleMuffBarcode: string | null
  lightweightBarcode: string | null
}

type ToastState = { kind: 'success' | 'error'; message: string } | null

// What the scanner is currently doing. While the modal or a server
// action is in flight we pause new decodes so the same barcode read
// 30x/sec doesn't spam writes or stack modals.
type ScanMode = 'idle' | 'busy' | 'modal'

// Vendor asset-tag whitelist. Real-world labels seen on rental gear
// include several patterns:
//   Clair        → C1109512, C1670274, C775553   (C + 6–7 digits)
//                  8091092, 8101383, 351686       (bare 6–7 digits)
//   Britannia    → 660319                          (bare 6 digits)
//   Riedel       → A64243                          (A + 5 digits)
//   Mixed bag    → other rental houses use letter-prefix codes
// Pattern: 4–12 uppercase-alphanumeric characters with NO spaces,
// dashes, or punctuation. Tight enough to reject background junk
// (URLs, RoHS Code 128 with `/` separators, English words from
// random scanned posters) while permissive enough for any short
// alphanumeric asset tag a vendor might stamp.
const ASSET_TAG_PATTERN = /^[A-Z0-9]{4,12}$/

/** Reject any decoded value that doesn't look like a short asset tag. */
function isValidAssetTag(s: string): boolean {
  return ASSET_TAG_PATTERN.test(s.trim().toUpperCase())
}

export function ScanContent({
  project,
  teamMembers,
  departmentSuggestions,
}: {
  project: { id: number; name: string }
  teamMembers: TeamMember[]
  departmentSuggestions: string[]
}) {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const lastScannedRef = useRef<{ value: string; at: number } | null>(null)
  const modeRef = useRef<ScanMode>('idle')
  const [cameraError, setCameraError] = useState<string | null>(null)
  // Front-facing webcams (laptop FaceTime cameras, selfie cameras on
  // phones) ship a mirrored video feed by default — so a barcode the
  // operator moves left appears to move right in the preview. The raw
  // stream ZXing reads is unaffected (decode still works), but the
  // mirror is disorienting when aiming. We flip the <video> element
  // back to non-mirrored via scaleX(-1) when the selected camera
  // looks front-facing.
  const [videoMirrored, setVideoMirrored] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [, startTransition] = useTransition()
  // When the assignment modal is open, this carries the data the modal
  // is acting on (existing radio + scanned barcode + an editable form
  // snapshot). null when the modal is closed.
  const [modal, setModal] = useState<{
    barcode: string
    targetRadio: { id: number; name: string }
    initial: KnownRadio | null // null → unknown-barcode branch
    /** When re-assigning a returned radio, carry the previous
     *  assignee snapshot so the modal can show a clickable chip:
     *  tap to repopulate the form with their info (e.g. they came
     *  right back to grab the same walkie). Nothing persists until
     *  Save. */
    previousUser?: {
      firstName: string | null
      lastName: string | null
      department: string | null
      position: string | null
      assignedToProjectMemberId: number | null
    } | null
  } | null>(null)
  const [manualBarcode, setManualBarcode] = useState('')

  // Input mode toggle — camera (default, phone / webcam) vs hardware
  // scanner (USB or Bluetooth HID-keyboard wedge like the Tera 8100).
  // Persisted across sessions so a station set up for hardware
  // scanning stays in that mode.
  type InputMode = 'camera' | 'scanner'
  const [inputMode, setInputMode] = usePersistentState<InputMode>(
    'radios:scanner:inputMode',
    'camera',
  )

  // Accessory state lives at this level so it survives the modal's
  // re-renders. Each chip is now a simple boolean toggle — picking
  // "Fist mic" just flips the flag; the camera no longer hijacks
  // into an accessory-scan flow asking for a barcode.
  const [fistMicFlag, setFistMicFlag] = useState(false)
  const [surveillanceFlag, setSurveillanceFlag] = useState(false)
  const [doubleMuffFlag, setDoubleMuffFlag] = useState(false)
  const [lightweightFlag, setLightweightFlag] = useState(false)
  // Barcode columns kept null — the assignRadioFromScan payload
  // still accepts them, but the scanner UI no longer captures them.
  // Pre-fill from the radio's existing values on re-issue so we
  // don't blow away barcodes that were entered some other way.
  const [fistMicBC, setFistMicBC] = useState<string | null>(null)
  const [surveillanceBC, setSurveillanceBC] = useState<string | null>(null)
  const [doubleMuffBC, setDoubleMuffBC] = useState<string | null>(null)
  const [lightweightBC, setLightweightBC] = useState<string | null>(null)

  // Seed (or reset) accessory state every time the modal opens with
  // a new radio — pre-fill from the radio's existing flags +
  // barcodes when re-issuing, blank when checking out a fresh radio.
  useEffect(() => {
    if (!modal) return
    setFistMicFlag(modal.initial?.fistMic ?? false)
    setSurveillanceFlag(modal.initial?.surveillance ?? false)
    setDoubleMuffFlag(modal.initial?.doubleMuff ?? false)
    setLightweightFlag(modal.initial?.lightweight ?? false)
    setFistMicBC(modal.initial?.fistMicBarcode ?? null)
    setSurveillanceBC(modal.initial?.surveillanceBarcode ?? null)
    setDoubleMuffBC(modal.initial?.doubleMuffBarcode ?? null)
    setLightweightBC(modal.initial?.lightweightBarcode ?? null)
  }, [modal])

  // Click handler given to each accessory chip. Simple flip — no
  // barcode capture, no scan-mode switch.
  const handleAccessoryToggle = useCallback(
    (key: AccessoryKey, currentlyOn: boolean) => {
      const next = !currentlyOn
      switch (key) {
        case 'fistMic':
          setFistMicFlag(next)
          if (!next) setFistMicBC(null)
          break
        case 'surveillance':
          setSurveillanceFlag(next)
          if (!next) setSurveillanceBC(null)
          break
        case 'doubleMuff':
          setDoubleMuffFlag(next)
          if (!next) setDoubleMuffBC(null)
          break
        case 'lightweight':
          setLightweightFlag(next)
          if (!next) setLightweightBC(null)
          break
      }
    },
    [],
  )

  const showToast = useCallback((kind: 'success' | 'error', message: string) => {
    setToast({ kind, message })
    setTimeout(() => setToast(null), 2800)
  }, [])

  // ─── Scanner beep ─────────────────────────────────────────────────
  // Real barcode scanners chirp once when they read a code. We mimic
  // that here with a short Web Audio square-wave so the operator gets
  // ear-confirmation each scan even when they can't watch the screen.
  //   • 1 beep  → scan acknowledged (about to go out — unknown radio
  //               or prompt branch). The assignment modal opens.
  //   • 2 beeps → auto-return completed (radio flipped to 'returned'
  //               without needing the operator to touch the modal).
  const audioCtxRef = useRef<AudioContext | null>(null)
  const beep = useCallback((count: 1 | 2) => {
    if (typeof window === 'undefined') return
    if (!audioCtxRef.current) {
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        if (!Ctor) return
        audioCtxRef.current = new Ctor()
      } catch {
        return
      }
    }
    const ctx = audioCtxRef.current
    if (!ctx) return
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
    // "Pluck": sine wave at 1200Hz with a fast exponential decay so
    // each beep reads as a soft pop instead of the harsh square-wave
    // chirp. 180ms gives the tail enough room to ring out before the
    // 70ms gap on a double-beep.
    const beepMs = 0.18
    const gapMs = 0.07
    for (let i = 0; i < count; i++) {
      const start = ctx.currentTime + i * (beepMs + gapMs)
      try {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = 1200
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.004)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + beepMs)
        osc.connect(gain).connect(ctx.destination)
        osc.start(start)
        osc.stop(start + beepMs + 0.01)
      } catch {
        // ignore; some browsers gate audio
      }
    }
  }, [])

  // Branching: lookup the barcode → either pop a modal (unknown or
  // returned → out) or auto-mark as returned (out → returned).
  const handleScan = useCallback(
    async (barcode: string) => {
      modeRef.current = 'busy'
      const result: RadioScanLookup = await lookupRadioByBarcode(project.id, barcode)
      if ('error' in result) {
        showToast('error', result.error)
        modeRef.current = 'idle'
        return
      }
      if (result.kind === 'auto-return') {
        // Auto-return — silently flip status to 'returned'.
        const res = await returnRadioByBarcode(project.id, barcode)
        modeRef.current = 'idle'
        if (res && 'error' in res && res.error) {
          showToast('error', res.error)
          return
        }
        // Double-beep = "radio returned to the pool" — distinct from
        // the single chirp used for outbound scans below.
        beep(2)
        // Include who had the walkie out so the operator confirms by
        // name, not just radio number — important when a crew member
        // is handing one back and you want to clock who's now clear.
        const who = [res.firstName, res.lastName]
          .map((s) => s?.trim())
          .filter(Boolean)
          .join(' ')
        showToast(
          'success',
          who
            ? `${res.name ?? barcode} returned · ${who}`
            : `${res.name ?? barcode} returned`,
        )
        // Server action revalidates /radios; the scanner itself doesn't
        // display the radio list so no router.refresh needed here.
        return
      }
      // Unknown OR returned → open the assignment modal.
      if (result.kind === 'unknown') {
        if (!result.targetRadio) {
          showToast(
            'error',
            'No blank radio rows left in this project — bulk-create more first.',
          )
          modeRef.current = 'idle'
          return
        }
        // Single-beep = scan acknowledged, modal opening for checkout.
        beep(1)
        setModal({
          barcode,
          targetRadio: result.targetRadio,
          initial: null,
        })
      } else {
        beep(1)
        // For a radio currently in 'returned' state, treat the modal
        // like a fresh check-out: blank person fields so the operator
        // doesn't have to manually clear the previous user before
        // typing the new one. Accessory flags + barcodes stay because
        // they describe the physical walkie, not who's holding it.
        // The DB write only happens on Save, so cancelling preserves
        // the previous user in the list.
        const isReturning = result.radio.status === 'returned'
        const hasPrev = isReturning && (
          (result.radio.firstName ?? '').trim() !== '' ||
          (result.radio.lastName ?? '').trim() !== ''
        )
        const initial = isReturning
          ? {
              ...result.radio,
              firstName: null,
              lastName: null,
              department: null,
              position: null,
              assignedToProjectMemberId: null,
            }
          : result.radio
        setModal({
          barcode,
          targetRadio: { id: result.radio.id, name: result.radio.name },
          initial,
          previousUser: hasPrev
            ? {
                firstName: result.radio.firstName,
                lastName: result.radio.lastName,
                department: result.radio.department,
                position: result.radio.position,
                assignedToProjectMemberId: result.radio.assignedToProjectMemberId,
              }
            : null,
        })
      }
      modeRef.current = 'modal'
    },
    [project.id, showToast, beep],
  )

  // ─── Camera lifecycle ─────────────────────────────────────────────
  useEffect(() => {
    // Skip the entire camera lifecycle when the operator picked the
    // hardware-scanner wedge mode. The mode-switch effect below will
    // tear down any running stream when this fires on re-mount.
    if (inputMode !== 'camera') return
    if (!videoRef.current) return
    // Decode hint:
    //   • TRY_HARDER — spend a bit more CPU per frame for harder reads
    //     (off-angle, low-contrast, partially obstructed). Pays off
    //     for small dense codes like the Clair `C######` tags.
    //
    // ALSO_INVERTED was the obvious companion (white-on-black labels)
    // but the installed @zxing/library 0.22.0 doesn't define it (added
    // in a later release). Bumping the package version is a separate
    // change — for now we live without the auto-inversion, since the
    // labels you've shown so far are all dark-on-light.
    const hints = new Map<DecodeHintType, unknown>()
    hints.set(DecodeHintType.TRY_HARDER, true)
    const reader = new BrowserMultiFormatReader(hints)
    let cancelled = false

    ;(async () => {
      if (cancelled || !videoRef.current) return
      // Default to non-mirrored. The post-stream block below checks
      // the active track's facingMode (the authoritative source)
      // and flips the preview only if the browser handed us the
      // user-facing camera.
      setVideoMirrored(false)
      try {
        // CAMERA SELECTION: pass `facingMode: { ideal: 'environment' }`
        // and let the browser pick the back camera natively. We used
        // to enumerateDevices() + match labels first, but iPadOS /
        // iOS Safari returns blank device labels until the user
        // grants camera permission — which meant the label regex
        // failed, we fell back to devices[0] (front camera on
        // iPads), pinned its deviceId, and `facingMode` couldn't
        // override the pin. Dropping the deviceId lets the
        // constraint do its job: back camera on phones/iPads,
        // gracefully falls back to whatever's available on laptops.
        //
        // RESOLUTION: deliberately NOT pinned to 1080p. Higher res
        // means more pixels per frame for ZXing to chew through,
        // which on mobile CPUs cuts the decode-loop frame rate and
        // makes the scanner *feel* slower even when individual
        // reads are sharper. Default browser resolution (usually
        // 640x480 or 720p) gives faster polling and more attempts
        // per second — which dominates for QR's built-in error
        // correction. Continuous focus + auto-exposure (applied
        // post-stream below) carry the load on damaged labels.
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
            },
          },
          videoRef.current!,
          (result, err) => {
              if (!result) return
              if (modeRef.current !== 'idle') return
              const value = result.getText().trim()
              if (!value) return

              // ── Center-region filter ─────────────────────────────
              // ZXing scans the full frame, which means background
              // codes (Pliant battery Data Matrix, RoHS Code 128,
              // adjacent radio tags) can trigger a read even when the
              // operator is aiming at one specific label. Require the
              // decoded result's points to sit inside the inner 60%
              // of the video; reject if any point falls outside.
              const video = videoRef.current
              if (video && video.videoWidth > 0) {
                const points = result.getResultPoints?.() ?? []
                const w = video.videoWidth
                const h = video.videoHeight
                // Allow ±30% from center on both axes.
                const minX = w * 0.2
                const maxX = w * 0.8
                const minY = h * 0.2
                const maxY = h * 0.8
                const outside = points.some((p) => {
                  const x = p.getX()
                  const y = p.getY()
                  return x < minX || x > maxX || y < minY || y > maxY
                })
                if (outside) return
              }

              // ── Asset-tag format filter ──────────────────────────
              // Accept the broad asset-tag pattern (4–12 uppercase
              // alphanumeric, no separators). Catches Clair tags
              // with or without the C prefix, Riedel A-prefixed
              // codes, Britannia Row bare digits, etc. Background
              // junk (UPC barcodes on packaging with 13 digits,
              // text on signage with spaces / slashes, URLs) gets
              // silently rejected and the scan loop keeps running.
              if (!isValidAssetTag(value)) return

              // Debounce same-barcode reads within 1.5s so a barcode
              // sitting in front of the camera doesn't re-fire.
              const now = Date.now()
              if (
                lastScannedRef.current &&
                lastScannedRef.current.value === value &&
                now - lastScannedRef.current.at < 1500
              ) {
                return
              }
              lastScannedRef.current = { value, at: now }
              void handleScan(value)
            },
          )
          if (cancelled) {
            controls.stop()
            return
          }
          controlsRef.current = controls

          // Stream is live — try to switch the camera into
          // continuous autofocus and continuous auto-exposure for
          // better reads on damaged / faded labels. Both flags are
          // non-standard (Image Capture spec); browsers that don't
          // support them will reject or silently ignore. We probe
          // the track's getCapabilities() first to skip the apply
          // call when the device says no.
          const stream = videoRef.current?.srcObject as MediaStream | null
          const track = stream?.getVideoTracks?.()[0]
          if (track && typeof track.getSettings === 'function') {
            // Authoritative front/back detection — getSettings() on
            // the active track reports facingMode reliably once the
            // stream is open, even when device labels were empty
            // (common on iOS). Only mirror when the camera is the
            // 'user' (front-facing) one.
            const settings = track.getSettings() as { facingMode?: string }
            setVideoMirrored(settings.facingMode === 'user')
          }
          if (track && typeof track.getCapabilities === 'function') {
            const caps = track.getCapabilities() as {
              focusMode?: string[]
              exposureMode?: string[]
            }
            const extra: Record<string, string> = {}
            if (caps.focusMode?.includes('continuous')) {
              extra.focusMode = 'continuous'
            }
            if (caps.exposureMode?.includes('continuous')) {
              extra.exposureMode = 'continuous'
            }
            if (Object.keys(extra).length > 0) {
              try {
                await track.applyConstraints({
                  advanced: [extra],
                } as MediaTrackConstraints)
              } catch {
                // Hardware refused — fine, default focus/exposure
                // still works, we just don't get the boost.
              }
            }
          }
        } catch (e) {
          const msg =
            e instanceof Error ? e.message : 'Camera unavailable — check permissions.'
          if (!cancelled) setCameraError(msg)
        }
      })()

    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [handleScan, inputMode])

  // Hardware-scanner wedge — captures fast-typed barcodes from a USB
  // or Bluetooth HID-keyboard scanner (e.g. Tera 8100) anywhere on
  // the page, ending in Enter / CR. Only active when inputMode is
  // 'scanner'. Skips when the user is typing in an editable element
  // so the manual barcode input still works the way the operator
  // expects.
  useEffect(() => {
    if (inputMode !== 'scanner') return
    let buffer = ''
    let lastKeyAt = 0
    // Inter-key threshold: hardware scanners emit chars in tight
    // bursts (typically <30ms apart). Anything slower is treated as
    // human typing and resets the buffer so a stray keypress doesn't
    // contaminate the next scan.
    const MAX_INTERVAL_MS = 100
    function isEditableTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (t.isContentEditable) return true
      return false
    }
    function onKey(e: KeyboardEvent) {
      // Don't fight with the manual barcode input; let the form's
      // onSubmit handle it (the scanner's Enter will fire submit
      // naturally on that input).
      if (isEditableTarget(e.target)) return
      const now = performance.now()
      if (now - lastKeyAt > MAX_INTERVAL_MS) buffer = ''
      lastKeyAt = now
      if (e.key === 'Enter') {
        const code = buffer.trim()
        buffer = ''
        if (code && modeRef.current === 'idle') {
          handleScan(code)
        }
        return
      }
      // Single-character printable keys only — ignore modifiers,
      // arrow keys, function keys, etc.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buffer += e.key
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inputMode, handleScan])

  // Closing the modal returns scanner to idle so the next decode fires.
  const closeModal = useCallback(() => {
    setModal(null)
    modeRef.current = 'idle'
    // Reset debounce so re-scanning the same barcode is allowed
    // (the modal was cancelled — they may want to retry).
    lastScannedRef.current = null
  }, [])

  // Manual entry fallback — for when the camera can't be opened (perm
  // denied, no device) so the operator can still complete a check-out.
  // Same asset-tag format validation as the camera path so typo'd
  // entries surface an error toast instead of hitting the server.
  function submitManual() {
    const value = manualBarcode.trim()
    if (!value) return
    if (!isValidAssetTag(value)) {
      showToast(
        'error',
        'Not a valid asset tag — 4–12 letters/digits, no spaces.',
      )
      return
    }
    setManualBarcode('')
    void handleScan(value)
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-black">
      {/* Top bar — close + project label.
          Relative parent so the centered accessory label can sit on
          the same row as the project info and the X without being
          shoved by either side's width. */}
      <div className="relative flex flex-shrink-0 items-center justify-between gap-3 bg-[#202020] px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-baseline gap-2">
          {/* "Scan" sits to the left of the project name, both at
              header weight. Cyan label tags this page as the scanner
              (matches the cyan accents used elsewhere on radios). */}
          <span className="shrink-0 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Scan
          </span>
          <h1 className="truncate text-2xl font-bold tracking-tight text-[#22a7d3] sm:text-3xl">
            {project.name}
          </h1>
        </div>
        {/* Input-mode toggle (desktop) — Camera vs Scanner. Centered
            in the top bar. On mobile the toggle moves to its own
            full-width row below the bar (see further down). */}
        <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 sm:flex">
          {(['camera', 'scanner'] as const).map((mode) => {
            const active = inputMode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setInputMode(mode)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-[#22a7d3] bg-[#22a7d3] text-white'
                    : 'border-white/15 text-gray-300 hover:border-white/30 hover:text-white'
                }`}
              >
                {mode === 'camera' ? 'Camera' : 'Scanner'}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => router.push(`/radios?project=${project.id}`)}
          aria-label="Close scanner"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
        >
          <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Mobile-only input-mode toggle row — full width, 50/50
          split. Sits directly under the top bar so it's the first
          thing the operator sees on phones (the toggle is centered
          in the top bar on desktop and hidden here). No bottom
          border — the camera viewport's dark background provides
          enough visual separation. */}
      <div className="flex flex-shrink-0 gap-2 bg-[#202020] px-4 py-2 sm:hidden">
        {(['camera', 'scanner'] as const).map((mode) => {
          const active = inputMode === mode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setInputMode(mode)}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-[#22a7d3] bg-[#22a7d3] text-white'
                  : 'border-white/15 text-gray-300 hover:border-white/30 hover:text-white'
              }`}
            >
              {mode === 'camera' ? 'Camera' : 'Scanner'}
            </button>
          )
        })}
      </div>

      {/* Camera viewport — fills the remaining space.
          (The accessory-scan label now lives in the top bar above,
          not as an overlay here, per the v2.3 chrome refresh.)
          When the operator picked the hardware-scanner wedge mode we
          render a calmer "Scanner ready" panel instead — no video,
          no permission prompts, page-level keydowns drive the
          lookup flow. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {inputMode === 'scanner' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="rounded-full border-2 border-[#22a7d3]/60 p-6">
              <svg className="size-12 text-[#22a7d3]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h3.375M15.75 3.75h3.375c.621 0 1.125.504 1.125 1.125v3.375M20.25 15.75v3.375c0 .621-.504 1.125-1.125 1.125h-3.375M8.25 20.25H4.875A1.125 1.125 0 0 1 3.75 19.125V15.75" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 12h10" />
              </svg>
            </div>
            <div className="text-lg font-semibold uppercase tracking-wider text-[#22a7d3]">
              Scanner ready
            </div>
            <div className="max-w-sm text-sm text-gray-400">
              Connect your USB or Bluetooth scanner (HID keyboard mode) and pull the trigger. The page captures the keystrokes — no input field focus needed.
            </div>
          </div>
        )}
        {inputMode === 'camera' && !cameraError && (
          <video
            ref={videoRef}
            // Front-facing cameras come pre-mirrored — flip back to
            // a non-mirrored view so the operator's hand motion
            // matches the on-screen barcode motion. Phone back
            // cameras (preferred) skip the flip and render natural.
            style={videoMirrored ? { transform: 'scaleX(-1)' } : undefined}
            className="h-full w-full object-cover"
            autoPlay
            muted
            playsInline
          />
        )}
        {/* Decoration: corner brackets framing a central scan zone */}
        {inputMode === 'camera' && !cameraError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-56 w-72 max-w-[80%] sm:h-64 sm:w-96">
              {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
                <span
                  key={corner}
                  className={`absolute size-8 border-[#22a7d3] ${
                    corner === 'tl'
                      ? 'left-0 top-0 border-l-2 border-t-2'
                      : corner === 'tr'
                        ? 'right-0 top-0 border-r-2 border-t-2'
                        : corner === 'bl'
                          ? 'bottom-0 left-0 border-b-2 border-l-2'
                          : 'bottom-0 right-0 border-b-2 border-r-2'
                  }`}
                />
              ))}
              <div className="absolute inset-x-0 -bottom-8 text-center text-[11px] uppercase tracking-wider text-white/70">
                Aim at the radio barcode
              </div>
            </div>
          </div>
        )}
        {inputMode === 'camera' && cameraError && (
          <div className="mx-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
            <div className="mb-2 font-semibold text-red-200">Camera unavailable</div>
            <p className="text-red-200/80">{cameraError}</p>
            <p className="mt-3 text-[12px] text-red-200/70">
              You can still type a barcode manually below.
            </p>
          </div>
        )}
      </div>

      {/* Bottom bar — manual barcode entry + Look up button. Extra
          bottom padding on mobile so the button clears the iOS PWA
          home-indicator strip and feels less crammed against the
          edge. Desktop reverts to symmetric py-3. No top border —
          the dark camera viewport above is its own divider. */}
      <div className="flex-shrink-0 bg-[#202020] px-4 pb-8 pt-3 sm:px-6 sm:py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submitManual()
          }}
          className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
        >
          <input
            type="text"
            value={manualBarcode}
            onChange={(e) => setManualBarcode(e.target.value)}
            placeholder="Enter barcode manually…"
            className="block w-full rounded-lg border border-white/10 bg-[#2a2a2a] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[#0178a3]"
          />
          <button
            type="submit"
            disabled={!manualBarcode.trim()}
            className="w-full whitespace-nowrap rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Look up
          </button>
        </form>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex max-w-md justify-center px-4`}
        >
          <div
            // Match the global ToastContainer chrome (bottom-right) —
            // solid green / red 90% with white text — so the scanner
            // success notification reads the same as every other
            // success toast in the app.
            className={`pointer-events-auto rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
              toast.kind === 'success'
                ? 'bg-green-500/90 text-white'
                : 'bg-red-500/90 text-white'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {/* Assignment modal — shows for the unknown / returned branches. */}
      {modal && (
        <div>
          <AssignmentModal
            projectName={project.name}
            barcode={modal.barcode}
            targetRadio={modal.targetRadio}
            initial={modal.initial}
            previousUser={modal.previousUser ?? null}
            teamMembers={teamMembers}
            departmentSuggestions={departmentSuggestions}
            fistMic={fistMicFlag}
            surveillance={surveillanceFlag}
            doubleMuff={doubleMuffFlag}
            lightweight={lightweightFlag}
            fistMicBarcode={fistMicBC}
            surveillanceBarcode={surveillanceBC}
            doubleMuffBarcode={doubleMuffBC}
            lightweightBarcode={lightweightBC}
            onAccessoryToggle={handleAccessoryToggle}
            onClose={closeModal}
            onSaved={(name) => {
              closeModal()
              showToast('success', `${name} checked out`)
              startTransition(() => router.refresh())
            }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Assignment modal ───────────────────────────────────────────────

type AccessoryKey = 'fistMic' | 'surveillance' | 'doubleMuff' | 'lightweight'

function AssignmentModal({
  projectName,
  barcode,
  targetRadio,
  initial,
  previousUser,
  teamMembers,
  departmentSuggestions,
  // Accessory state is now lifted up to ScanContent so it survives
  // the modal's hide/show during accessory-scan mode. The modal
  // becomes a pure consumer of these props.
  fistMic,
  surveillance,
  doubleMuff,
  lightweight,
  fistMicBarcode,
  surveillanceBarcode,
  doubleMuffBarcode,
  lightweightBarcode,
  onAccessoryToggle,
  onClose,
  onSaved,
}: {
  projectName: string
  barcode: string
  targetRadio: { id: number; name: string }
  initial: KnownRadio | null
  /** Previous assignee snapshot when re-assigning a returned radio.
   *  Surfaced as a clickable header chip — tap to restore the
   *  previous person's info into the form (useful when the same
   *  crew is taking the walkie right back out). Nothing persists
   *  until Save. */
  previousUser: {
    firstName: string | null
    lastName: string | null
    department: string | null
    position: string | null
    assignedToProjectMemberId: number | null
  } | null
  teamMembers: TeamMember[]
  departmentSuggestions: string[]
  fistMic: boolean
  surveillance: boolean
  doubleMuff: boolean
  lightweight: boolean
  fistMicBarcode: string | null
  surveillanceBarcode: string | null
  doubleMuffBarcode: string | null
  lightweightBarcode: string | null
  onAccessoryToggle: (key: AccessoryKey, currentlyOn: boolean) => void
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? '')
  const [lastName, setLastName] = useState(initial?.lastName ?? '')
  const [department, setDepartment] = useState(initial?.department ?? '')
  const [position, setPosition] = useState(initial?.position ?? '')
  const [memberId, setMemberId] = useState<number | null>(
    initial?.assignedToProjectMemberId ?? null,
  )
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const firstNameSuggestions = useMemo(
    () => Array.from(new Set(teamMembers.map((m) => m.firstName))).sort(),
    [teamMembers],
  )
  const lastNameSuggestions = useMemo(
    () => Array.from(new Set(teamMembers.map((m) => m.lastName))).sort(),
    [teamMembers],
  )
  const positionSuggestions = useMemo(
    () =>
      Array.from(
        new Set(teamMembers.map((m) => m.position?.trim()).filter((p): p is string => !!p)),
      ).sort(),
    [teamMembers],
  )

  // Auto-stamp the member FK + pre-fill dept/position when the typed
  // name matches a known team member. Mirrors the radio-edit card.
  useEffect(() => {
    const fn = firstName.trim().toLowerCase()
    const ln = lastName.trim().toLowerCase()
    if (!fn || !ln) return
    const match = teamMembers.find(
      (m) => m.firstName.toLowerCase() === fn && m.lastName.toLowerCase() === ln,
    )
    if (match) {
      setMemberId(match.id)
      setDepartment((d) => (d.trim() === '' ? match.department ?? '' : d))
      setPosition((p) => (p.trim() === '' ? match.position ?? '' : p))
    } else {
      setMemberId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, lastName, teamMembers])

  function save() {
    setError(null)
    startTransition(async () => {
      const res = await assignRadioFromScan(targetRadio.id, {
        barcode,
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        department: department.trim() || null,
        position: position.trim() || null,
        assignedToProjectMemberId: memberId,
        fistMic,
        surveillance,
        doubleMuff,
        lightweight,
        fistMicBarcode: fistMic ? fistMicBarcode : null,
        surveillanceBarcode: surveillance ? surveillanceBarcode : null,
        doubleMuffBarcode: doubleMuff ? doubleMuffBarcode : null,
        lightweightBarcode: lightweight ? lightweightBarcode : null,
      })
      if (res.error) {
        setError(res.error)
        return
      }
      // Action returns the actual destination radio name — collisions
      // hop to the next blank row, so the toast must reflect where
      // the data actually landed (not the slot we opened the modal on).
      onSaved(res.radioName ?? targetRadio.name)
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 sm:items-center">
      <div className="w-full max-w-xl rounded-t-2xl border border-white/10 bg-[#1c1c1c] p-4 sm:rounded-2xl sm:p-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              {initial ? 'Check out' : 'Assign new barcode'}
            </div>
            <div className="text-lg font-semibold text-white sm:text-xl">
              <span className="text-[#22a7d3]">{targetRadio.name}</span>
              <span className="ml-2 font-mono text-xs text-gray-400">{barcode}</span>
            </div>
          </div>
          <span className="hidden text-xs text-gray-500 sm:inline">{projectName}</span>
        </div>
        {/* Previous-user chip — when a returned walkie comes back in
            for a new user, show the previous holder as a clickable
            chip with name + department + position. Tap to restore
            them into the form (e.g. same person taking it right
            back out); nothing persists until Save. */}
        {previousUser && (() => {
          const prevName = [previousUser.firstName, previousUser.lastName]
            .map((s) => s?.trim())
            .filter(Boolean)
            .join(' ')
          const meta = [previousUser.department, previousUser.position]
            .map((s) => s?.trim())
            .filter(Boolean)
            .join(' · ')
          return (
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Previous
              </span>
              {/* Sized + shaped to match the Save button below
                  (rounded-lg, px-4 py-2, text-sm font-medium,
                  w-full sm:w-auto) so the chip reads as a peer
                  action — tap to restore the previous user. */}
              <button
                type="button"
                onClick={() => {
                  setFirstName(previousUser.firstName ?? '')
                  setLastName(previousUser.lastName ?? '')
                  setDepartment(previousUser.department ?? '')
                  setPosition(previousUser.position ?? '')
                  setMemberId(previousUser.assignedToProjectMemberId)
                }}
                className="flex w-full items-baseline justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-[#22a7d3]/60 hover:bg-[#22a7d3]/10 sm:w-auto"
                aria-label={`Restore previous user ${prevName || ''}`}
              >
                <span className="font-semibold text-[#22a7d3]">{prevName || '—'}</span>
                {meta && <span className="text-gray-400">· {meta}</span>}
              </button>
            </div>
          )
        })()}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <ComboboxInput
            compact
            label="First name"
            value={firstName}
            options={firstNameSuggestions}
            onChange={setFirstName}
            autoFocus
          />
          <ComboboxInput
            compact
            label="Last name"
            value={lastName}
            options={lastNameSuggestions}
            onChange={setLastName}
          />
          <ComboboxInput
            compact
            label="Department"
            value={department}
            options={departmentSuggestions}
            onChange={setDepartment}
            placeholder="Audio, RF"
          />
          <ComboboxInput
            compact
            label="Position"
            value={position}
            options={positionSuggestions}
            onChange={setPosition}
            placeholder="A1, PLHQ"
          />
        </div>

        <div className="mt-3">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Accessories
          </span>
          {/* Each chip toggles its accessory flag. Flipping a chip
              OFF→ON delegates to ScanContent via onAccessoryToggle —
              the parent hides this modal and switches the camera
              into accessory-scan mode so the operator can scan the
              accessory's barcode (or hit Skip to pair without one).
              Flipping ON→OFF clears flag + barcode in one step. */}
          <div className="flex flex-wrap gap-2">
            <AccessoryChip
              label="Fist mic"
              on={fistMic}
              barcode={fistMicBarcode}
              disabled={isPending}
              onClick={() => onAccessoryToggle('fistMic', fistMic)}
            />
            <AccessoryChip
              label="Surveillance"
              on={surveillance}
              barcode={surveillanceBarcode}
              disabled={isPending}
              onClick={() => onAccessoryToggle('surveillance', surveillance)}
            />
            <AccessoryChip
              label="Double"
              on={doubleMuff}
              barcode={doubleMuffBarcode}
              disabled={isPending}
              onClick={() => onAccessoryToggle('doubleMuff', doubleMuff)}
            />
            <AccessoryChip
              label="LWHS"
              on={lightweight}
              barcode={lightweightBarcode}
              disabled={isPending}
              onClick={() => onAccessoryToggle('lightweight', lightweight)}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="w-full rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

    </div>
  )
}

function AccessoryChip({
  label,
  on,
  barcode,
  disabled,
  onClick,
}: {
  label: string
  on: boolean
  barcode: string | null
  disabled?: boolean
  onClick: () => void
}) {
  // Three visual states encode capture status:
  //   • off           → dark neutral chip
  //   • on, no scan   → cyan border + cyan-tinted bg (Skip path; the
  //                     accessory is paired but un-barcoded)
  //   • on, scanned   → GREEN border + green-tinted bg (barcode
  //                     captured; the chip becomes its own confirmation)
  // Color now carries the signal, so the trailing dot is gone.
  const captured = on && !!barcode
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={on && barcode ? `Barcode: ${barcode}` : undefined}
      className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        captured
          ? 'border-green-500 bg-green-500/20 text-green-400'
          : on
            ? 'border-[#0178a3] bg-[#0178a3]/10 text-[#22a7d3]'
            : 'border-white/10 bg-[#202020] text-gray-300 hover:border-white/20 hover:bg-white/[0.04]'
      }`}
    >
      <span>{label}</span>
    </button>
  )
}

function ToggleChip({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      disabled={disabled}
      aria-pressed={value}
      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        value
          ? 'border-[#0178a3] bg-[#0178a3]/20 text-[#22a7d3]'
          : 'border-white/10 bg-[#202020] text-gray-300 hover:border-white/20 hover:bg-white/[0.04]'
      }`}
    >
      {label}
    </button>
  )
}
