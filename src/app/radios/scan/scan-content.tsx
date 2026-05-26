'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BrowserMultiFormatReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { ComboboxInput } from '@/components/combobox-input'
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
  const [toast, setToast] = useState<ToastState>(null)
  const [, startTransition] = useTransition()
  // When the assignment modal is open, this carries the data the modal
  // is acting on (existing radio + scanned barcode + an editable form
  // snapshot). null when the modal is closed.
  const [modal, setModal] = useState<{
    barcode: string
    targetRadio: { id: number; name: string }
    initial: KnownRadio | null // null → unknown-barcode branch
  } | null>(null)
  const [manualBarcode, setManualBarcode] = useState('')

  // ─── Accessory scan mode ─────────────────────────────────────────
  // When the assignment modal is open and the operator toggles an
  // accessory chip OFF→ON, we want them to scan the accessory's
  // barcode WITHOUT a nested modal. Instead the assignment modal
  // gets hidden (display:none, state preserved), a label appears at
  // the top of the camera viewport announcing the accessory, and a
  // Skip button takes over the bottom action bar. Scanning a code
  // in this mode captures it for that accessory and snaps back to
  // the assignment modal. (AccessoryKey + ACCESSORY_LABELS live at
  // module scope below so the modal can share the types.)
  const [accessoryScanMode, setAccessoryScanMode] = useState<AccessoryKey | null>(null)

  // Accessory state lives at this level so it survives the modal's
  // hide/show during accessory scan mode. The modal becomes a
  // controlled consumer.
  const [fistMicFlag, setFistMicFlag] = useState(false)
  const [surveillanceFlag, setSurveillanceFlag] = useState(false)
  const [doubleMuffFlag, setDoubleMuffFlag] = useState(false)
  const [lightweightFlag, setLightweightFlag] = useState(false)
  const [fistMicBC, setFistMicBC] = useState<string | null>(null)
  const [surveillanceBC, setSurveillanceBC] = useState<string | null>(null)
  const [doubleMuffBC, setDoubleMuffBC] = useState<string | null>(null)
  const [lightweightBC, setLightweightBC] = useState<string | null>(null)

  // Seed (or reset) accessory state every time the modal opens with a
  // new radio — pre-fill from the radio's existing flags + barcodes
  // when re-issuing, blank when checking out a fresh radio.
  useEffect(() => {
    if (!modal) {
      setAccessoryScanMode(null)
      return
    }
    setFistMicFlag(modal.initial?.fistMic ?? false)
    setSurveillanceFlag(modal.initial?.surveillance ?? false)
    setDoubleMuffFlag(modal.initial?.doubleMuff ?? false)
    setLightweightFlag(modal.initial?.lightweight ?? false)
    setFistMicBC(modal.initial?.fistMicBarcode ?? null)
    setSurveillanceBC(modal.initial?.surveillanceBarcode ?? null)
    setDoubleMuffBC(modal.initial?.doubleMuffBarcode ?? null)
    setLightweightBC(modal.initial?.lightweightBarcode ?? null)
  }, [modal])

  // Click handler given to each accessory chip. Toggling ON requests
  // an accessory scan; toggling OFF clears the flag + any barcode.
  const handleAccessoryToggle = useCallback(
    (key: AccessoryKey, currentlyOn: boolean) => {
      if (currentlyOn) {
        // Going OFF — clear flag + barcode in one step.
        switch (key) {
          case 'fistMic':
            setFistMicFlag(false)
            setFistMicBC(null)
            break
          case 'surveillance':
            setSurveillanceFlag(false)
            setSurveillanceBC(null)
            break
          case 'doubleMuff':
            setDoubleMuffFlag(false)
            setDoubleMuffBC(null)
            break
          case 'lightweight':
            setLightweightFlag(false)
            setLightweightBC(null)
            break
        }
      } else {
        // Going ON — switch into accessory-scan mode. The assignment
        // modal hides while the camera + Skip button take over.
        setAccessoryScanMode(key)
        modeRef.current = 'idle'
        lastScannedRef.current = null
      }
    },
    [],
  )

  // Skip = pair accessory ON without a barcode, back to the modal.
  const skipAccessoryScan = useCallback(() => {
    if (!accessoryScanMode) return
    const key = accessoryScanMode
    switch (key) {
      case 'fistMic':
        setFistMicFlag(true)
        setFistMicBC('')
        break
      case 'surveillance':
        setSurveillanceFlag(true)
        setSurveillanceBC('')
        break
      case 'doubleMuff':
        setDoubleMuffFlag(true)
        setDoubleMuffBC('')
        break
      case 'lightweight':
        setLightweightFlag(true)
        setLightweightBC('')
        break
    }
    setAccessoryScanMode(null)
    modeRef.current = 'modal'
  }, [accessoryScanMode])

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
    const beepMs = 0.09
    const gapMs = 0.07
    for (let i = 0; i < count; i++) {
      const start = ctx.currentTime + i * (beepMs + gapMs)
      try {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'square'
        osc.frequency.value = 2200
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.004)
        gain.gain.setValueAtTime(0.18, start + beepMs - 0.012)
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
      // Accessory-scan branch: short-circuit any radio lookup. The
      // captured barcode is the accessory's, not a radio's.
      if (accessoryScanMode) {
        const key = accessoryScanMode
        switch (key) {
          case 'fistMic':
            setFistMicFlag(true)
            setFistMicBC(barcode)
            break
          case 'surveillance':
            setSurveillanceFlag(true)
            setSurveillanceBC(barcode)
            break
          case 'doubleMuff':
            setDoubleMuffFlag(true)
            setDoubleMuffBC(barcode)
            break
          case 'lightweight':
            setLightweightFlag(true)
            setLightweightBC(barcode)
            break
        }
        setAccessoryScanMode(null)
        modeRef.current = 'modal'
        beep(1)
        return
      }

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
        showToast('success', `${res.name ?? barcode} returned`)
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
        setModal({
          barcode,
          targetRadio: { id: result.radio.id, name: result.radio.name },
          initial: result.radio,
        })
      }
      modeRef.current = 'modal'
    },
    [project.id, showToast, beep, accessoryScanMode],
  )

  // ─── Camera lifecycle ─────────────────────────────────────────────
  useEffect(() => {
    if (!videoRef.current) return
    const reader = new BrowserMultiFormatReader()
    let cancelled = false

    BrowserMultiFormatReader.listVideoInputDevices()
      .then(async (devices) => {
        if (cancelled || !videoRef.current) return
        if (devices.length === 0) {
          setCameraError('No camera detected on this device.')
          return
        }
        // Prefer a back-facing camera on phones — label heuristics
        // since spec exposes no flag. Falls back to first device.
        const back =
          devices.find((d) => /back|rear|environment/i.test(d.label)) ?? devices[0]
        try {
          const controls = await reader.decodeFromVideoDevice(
            back.deviceId,
            videoRef.current!,
            (result, err) => {
              if (!result) return
              if (modeRef.current !== 'idle') return
              const value = result.getText().trim()
              if (!value) return
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
        } catch (e) {
          const msg =
            e instanceof Error ? e.message : 'Camera unavailable — check permissions.'
          if (!cancelled) setCameraError(msg)
        }
      })
      .catch((e) => {
        const msg =
          e instanceof Error ? e.message : 'Unable to list cameras on this device.'
        if (!cancelled) setCameraError(msg)
      })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [handleScan])

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
  function submitManual() {
    const value = manualBarcode.trim()
    if (!value) return
    setManualBarcode('')
    void handleScan(value)
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-black">
      {/* Top bar — close + project label */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#202020] px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Scan
          </div>
          <div className="truncate text-sm font-semibold text-white sm:text-base">
            {project.name}
          </div>
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

      {/* Camera viewport — fills the remaining space */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {/* Accessory-scan label — top-center over the camera. Only
            renders while accessoryScanMode is set; tells the operator
            which accessory's barcode is about to be captured. */}
        {accessoryScanMode && (
          <div className="pointer-events-none absolute inset-x-0 top-6 z-30 flex justify-center px-4">
            <div className="rounded-full bg-[#0178a3] px-5 py-2 text-base font-semibold uppercase tracking-wider text-white shadow-lg sm:text-lg">
              Scan {ACCESSORY_LABELS[accessoryScanMode]}
            </div>
          </div>
        )}
        {!cameraError && (
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            autoPlay
            muted
            playsInline
          />
        )}
        {/* Decoration: corner brackets framing a central scan zone */}
        {!cameraError && (
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
        {cameraError && (
          <div className="mx-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
            <div className="mb-2 font-semibold text-red-200">Camera unavailable</div>
            <p className="text-red-200/80">{cameraError}</p>
            <p className="mt-3 text-[12px] text-red-200/70">
              You can still type a barcode manually below.
            </p>
          </div>
        )}
      </div>

      {/* Bottom bar — flips between two layouts:
          • Normal scan mode  → manual barcode entry + Look up button.
          • Accessory scan mode → single full-width Skip button so the
            operator can pair the accessory without a barcode and
            return to the assignment modal. Same chip styling as the
            Look up button. */}
      <div className="flex-shrink-0 border-t border-white/10 bg-[#202020] px-4 py-3 sm:px-6">
        {accessoryScanMode ? (
          <button
            type="button"
            onClick={skipAccessoryScan}
            className="w-full rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7]"
          >
            Skip {ACCESSORY_LABELS[accessoryScanMode]} barcode
          </button>
        ) : (
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
              className="w-full rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              Look up
            </button>
          </form>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex max-w-md justify-center px-4`}
        >
          <div
            className={`pointer-events-auto rounded-lg border px-4 py-2 text-sm font-medium shadow-2xl ${
              toast.kind === 'success'
                ? 'border-green-400/40 bg-green-500/15 text-green-200'
                : 'border-red-500/40 bg-red-500/15 text-red-200'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {/* Assignment modal — shows for the unknown / returned branches.
          While accessoryScanMode is set the modal hides via display:
          none but stays mounted so its form state survives the
          camera detour. */}
      {modal && (
        <div style={accessoryScanMode ? { display: 'none' } : undefined}>
          <AssignmentModal
            projectName={project.name}
            barcode={modal.barcode}
            targetRadio={modal.targetRadio}
            initial={modal.initial}
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
      onSaved(targetRadio.name)
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
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={on && barcode ? `Barcode: ${barcode}` : undefined}
      className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        on
          ? 'border-[#0178a3] bg-[#0178a3]/20 text-[#22a7d3]'
          : 'border-white/10 bg-[#202020] text-gray-300 hover:border-white/20 hover:bg-white/[0.04]'
      }`}
    >
      <span>{label}</span>
      {/* When the accessory is on, show a tiny indicator: filled cyan
          dot if barcode captured, hollow ring if paired-no-barcode. */}
      {on && (
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${barcode ? 'bg-[#22a7d3]' : 'ring-1 ring-[#22a7d3]'}`}
        />
      )}
    </button>
  )
}

const ACCESSORY_LABELS: Record<
  'fistMic' | 'surveillance' | 'doubleMuff' | 'lightweight',
  string
> = {
  fistMic: 'Fist mic',
  surveillance: 'Surveillance',
  doubleMuff: 'Double',
  lightweight: 'LWHS',
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
