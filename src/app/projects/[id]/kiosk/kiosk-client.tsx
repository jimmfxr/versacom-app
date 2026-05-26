'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { ComboboxInput } from '@/components/combobox-input'
import { createKioskMember, updatePendingMember } from './actions'

const QR_COUNTDOWN_SECONDS = 15
const PHONE_READY_SECONDS = 5
/** How often the kiosk re-fetches the pending check-in list. */
const PENDING_POLL_MS = 4_000

type PendingMember = {
  id: number
  firstName: string
  lastName: string
  position: string | null
  department: string | null
  equipmentNames: string[]
}

type KioskView =
  | { kind: 'form' }
  | { kind: 'edit'; member: PendingMember }
  | { kind: 'phone-ready'; firstName: string; lastName: string; joinUrl: string }
  | { kind: 'qr'; firstName: string; lastName: string; joinUrl: string }

export function KioskClient({
  projectId,
  projectName,
  pending: initialPending,
  positionSuggestions: initialPositionSuggestions,
  departmentSuggestions: initialDepartmentSuggestions,
}: {
  projectId: number
  projectName: string
  pending: PendingMember[]
  positionSuggestions: string[]
  departmentSuggestions: string[]
}) {
  const router = useRouter()
  const [view, setView] = useState<KioskView>({ kind: 'form' })

  // Local state seeded from the server-rendered props, then incrementally
  // refreshed by hitting the JSON-only `/api/projects/[id]/kiosk-pending`
  // endpoint every 4s. Using local state + an API poll (instead of the
  // old `router.refresh()` interval) is what kills the visible glitch
  // on the live kiosk: router.refresh re-fetches the whole Server
  // Component tree and triggers a full client re-render — combobox
  // focus would reset, the pending list would briefly flash, etc.
  const [pending, setPending] = useState<PendingMember[]>(initialPending)
  const [positionSuggestions, setPositionSuggestions] = useState<string[]>(
    initialPositionSuggestions,
  )
  const [departmentSuggestions, setDepartmentSuggestions] = useState<string[]>(
    initialDepartmentSuggestions,
  )

  function close() {
    router.push(`/projects/${projectId}`)
  }

  // Cheap deep-equality check that lets us skip setState (and the
  // resulting re-render) when the polled payload didn't actually
  // change. Most polls return identical data, so this collapses the
  // hot path to a single string compare.
  function sameAsPrev<T>(prev: T, next: T): boolean {
    try {
      return JSON.stringify(prev) === JSON.stringify(next)
    } catch {
      return false
    }
  }

  const refresh = useRef(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/kiosk-pending`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = (await res.json()) as {
        pending: PendingMember[]
        positionSuggestions: string[]
        departmentSuggestions: string[]
      }
      setPending((prev) => (sameAsPrev(prev, data.pending) ? prev : data.pending))
      setPositionSuggestions((prev) =>
        sameAsPrev(prev, data.positionSuggestions) ? prev : data.positionSuggestions,
      )
      setDepartmentSuggestions((prev) =>
        sameAsPrev(prev, data.departmentSuggestions)
          ? prev
          : data.departmentSuggestions,
      )
    } catch {
      // Swallow network blips — next tick will retry.
    }
  })

  useEffect(() => {
    const interval = setInterval(() => {
      void refresh.current()
    }, PENDING_POLL_MS)
    return () => clearInterval(interval)
  }, [])

  // Auto-dismiss the QR card the moment the person we're showing it for
  // disappears from pending — i.e. they set their PIN on their phone.
  // Way better UX than always waiting for the 20-second timer.
  //
  // Guard: a brand-new member submitted from the form might not show up
  // in the polled `pending` array yet (server data is up to ~4s stale).
  // Only auto-dismiss after we've SEEN them in pending at least once —
  // that proves the polling caught up and their subsequent absence
  // really means "they finished signing up".
  const sawInPendingRef = useRef(false)
  useEffect(() => {
    if (view.kind !== 'qr') {
      sawInPendingRef.current = false
      return
    }
    const matches = (m: PendingMember) =>
      m.firstName.toLowerCase() === view.firstName.toLowerCase() &&
      m.lastName.toLowerCase() === view.lastName.toLowerCase()
    const stillPending = pending.some(matches)
    if (stillPending) {
      sawInPendingRef.current = true
      return
    }
    // Not in pending right now — only auto-dismiss if we previously saw
    // them there. Otherwise the polling just hasn't caught up yet.
    if (sawInPendingRef.current) {
      setView({ kind: 'form' })
    }
  }, [view, pending])

  return (
    // h-[100dvh] + flex column locks the kiosk to the viewport (dvh
    // accounts for iOS Safari's collapsible chrome). Children flex to
    // consume remaining space so the pending list scroll region grows
    // dynamically — fits 5 cards on a small screen, 13 on iPad Pro.
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-[#202020] px-4 pb-0 pt-6 sm:pt-10">
      {/* Close (returns to project Team tab) */}
      <button
        type="button"
        onClick={close}
        aria-label="Close kiosk"
        className="absolute right-4 top-4 z-10 rounded-md p-2 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white sm:right-6 sm:top-6"
      >
        <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Layout split:
          - Form view keeps the logo pinned at top and the pending list
            growing to fill below it.
          - Edit / phone-ready / QR views vertically center the LOGO +
            card as a group, so the logo follows the card to the middle
            of the page. */}
      {view.kind === 'form' ? (
        <>
          <div className="mb-10 flex flex-shrink-0 justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/clair_logo_white.png" alt="Clair" className="h-16 w-auto" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <FormView
              projectId={projectId}
              projectName={projectName}
              onCreated={(r) => setView({ kind: 'phone-ready', ...r })}
              pending={pending}
              positionSuggestions={positionSuggestions}
              departmentSuggestions={departmentSuggestions}
              onPickPending={(m) => setView({ kind: 'edit', member: m })}
            />
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden">
          <div className="mb-10 flex flex-shrink-0 justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/clair_logo_white.png" alt="Clair" className="h-16 w-auto" />
          </div>

          {view.kind === 'edit' && (
            <EditView
              member={view.member}
              projectName={projectName}
              positionSuggestions={positionSuggestions}
              departmentSuggestions={departmentSuggestions}
              onSaved={(r) => setView({ kind: 'phone-ready', ...r })}
              onCancel={() => setView({ kind: 'form' })}
            />
          )}

          {view.kind === 'phone-ready' && (
            <PhoneReadyView
              firstName={view.firstName}
              onContinue={() =>
                setView({
                  kind: 'qr',
                  firstName: view.firstName,
                  lastName: view.lastName,
                  joinUrl: view.joinUrl,
                })
              }
            />
          )}

          {view.kind === 'qr' && (
            <QrView
              firstName={view.firstName}
              lastName={view.lastName}
              joinUrl={view.joinUrl}
              onDone={() => {
                setView({ kind: 'form' })
                // Kick the API poll so the just-added/just-edited member
                // shows up immediately without waiting for the next 4s
                // tick. No router.refresh() — that's what causes the
                // glitchy full-page re-render this commit removes.
                void refresh.current()
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function FormView({
  projectId,
  projectName,
  pending,
  positionSuggestions,
  departmentSuggestions,
  onCreated,
  onPickPending,
}: {
  projectId: number
  projectName: string
  pending: PendingMember[]
  positionSuggestions: string[]
  departmentSuggestions: string[]
  onCreated: (r: { firstName: string; lastName: string; joinUrl: string }) => void
  onPickPending: (m: PendingMember) => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [position, setPosition] = useState('')
  const [department, setDepartment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [pending2, startTransition] = useTransition()
  const [pendingSearch, setPendingSearch] = useState('')

  const filteredPending = (() => {
    const q = pendingSearch.trim().toLowerCase()
    if (!q) return pending
    return pending.filter((m) => {
      const haystack = `${m.firstName} ${m.lastName} ${m.position ?? ''} ${m.equipmentNames.join(' ')}`.toLowerCase()
      return haystack.includes(q)
    })
  })()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createKioskMember(projectId, firstName, lastName, position, department)
      if ('error' in res) {
        setError(res.error)
        return
      }
      setFirstName('')
      setLastName('')
      setPosition('')
      setDepartment('')
      onCreated(res)
    })
  }

  return (
    // Flex column so the pending list section can grow with flex-1 and
    // its inner scroll region fills whatever vertical space the form
    // didn't claim.
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Add form — same width + style as login. Fixed height. */}
      <div className="mx-auto w-full max-w-sm flex-shrink-0">
        <h2 className="mb-2 text-center text-xl font-semibold text-white">Add Crew</h2>
        <p className="mb-6 text-center text-lg font-semibold text-[#22a7d3]">{projectName}</p>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className="mb-1 block text-sm font-medium text-gray-400">
                First Name
              </label>
              <input
                id="firstName"
                type="text"
                placeholder="First Name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={pending2}
                className="w-full rounded-lg border border-white/10 px-3.5 py-2.5 text-base text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3] disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="lastName" className="mb-1 block text-sm font-medium text-gray-400">
                Last Name
              </label>
              <input
                id="lastName"
                type="text"
                placeholder="Last Name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={pending2}
                className="w-full rounded-lg border border-white/10 px-3.5 py-2.5 text-base text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3] disabled:opacity-50"
              />
            </div>
          </div>
          {/* Department (left) + Position (right) share a row. Both
              are free-text comboboxes that autocomplete from existing
              values on this project. */}
          <div className="grid grid-cols-2 gap-3">
            <ComboboxInput
              label="Department"
              value={department}
              onChange={setDepartment}
              options={departmentSuggestions}
              placeholder="e.g. Audio, RF"
            />
            <ComboboxInput
              label="Position"
              value={position}
              onChange={setPosition}
              options={positionSuggestions}
              placeholder="e.g. A1, PLHQ"
            />
          </div>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={pending2 || !firstName.trim() || !lastName.trim()}
            className="w-full rounded-lg bg-[#0178a3] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending2 ? 'Adding…' : 'Submit'}
          </button>
        </form>
      </div>

      {/* Divider — fixed */}
      <div className="mx-auto my-10 w-full max-w-3xl flex-shrink-0 border-t border-white/[0.08]" />

      {/* Pending — full width container, capped wider for readability.
          flex-1 + min-h-0 so the inner scroll container can size against
          remaining viewport height. */}
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <h3 className="mb-4 flex-shrink-0 text-center text-sm font-semibold uppercase tracking-wider text-gray-400">
          Pending Check-ins
          {pending.length > 0 && (
            <span className="ml-2 text-xs font-normal text-gray-600">{pending.length}</span>
          )}
        </h3>
        {pending.length === 0 ? (
          <p className="text-center text-sm text-gray-500">
            No one waiting. Add a crew member above to begin.
          </p>
        ) : (
          // Inner flex column so the search input is fixed and the scroll
          // region grows to fill remaining height.
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex-shrink-0">
              <input
                type="text"
                placeholder="Search pending check-ins..."
                value={pendingSearch}
                onChange={(e) => setPendingSearch(e.target.value)}
                className="w-full rounded-lg border-2 border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white focus:border-[#0178a3]"
              />
            </div>
            {filteredPending.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
                No matches for &ldquo;{pendingSearch}&rdquo;.
              </p>
            ) : (
              // flex-initial: container hugs its content when there's
              // room (no partial card cut). min-h-0 still lets it
              // shrink below content size when too many cards, at which
              // point overflow-y-auto kicks in. pb-4 matches the inner
              // scroll padding used on project / tasks pages.
              <div className="min-h-0 flex-initial divide-y divide-white/[0.06] overflow-y-auto overscroll-none pb-4 pr-1">
                {filteredPending.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onPickPending(m)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {m.equipmentNames.length > 0 && (
                          <span className="font-mono text-base font-bold text-[#22a7d3]">
                            {m.equipmentNames.join(', ')}
                          </span>
                        )}
                        <span className="text-base font-semibold text-white">
                          {m.firstName} {m.lastName}
                        </span>
                        {m.position && (
                          <>
                            <span className="text-sm text-gray-500">·</span>
                            <span className="text-sm text-[#22a7d3]">{m.position}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Edit →
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EditView({
  member,
  projectName,
  positionSuggestions,
  departmentSuggestions,
  onSaved,
  onCancel,
}: {
  member: PendingMember
  projectName: string
  positionSuggestions: string[]
  departmentSuggestions: string[]
  onSaved: (r: { firstName: string; lastName: string; joinUrl: string }) => void
  onCancel: () => void
}) {
  const [firstName, setFirstName] = useState(member.firstName)
  const [lastName, setLastName] = useState(member.lastName)
  const [position, setPosition] = useState(member.position ?? '')
  const [department, setDepartment] = useState(member.department ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await updatePendingMember(member.id, {
        firstName,
        lastName,
        position: position.trim() || null,
        department: department.trim() || null,
      })
      if ('error' in res) {
        setError(res.error)
        return
      }
      onSaved(res)
    })
  }

  return (
    // my-auto vertically centers the edit form inside the remaining
    // viewport slot — admins pick a pending check-in and the form they
    // see drops into the middle of the page instead of hugging the top.
    <div className="mx-auto w-full max-w-sm">
      <h2 className="mb-2 text-center text-xl font-semibold text-white">Edit Crew</h2>
      <p className="mb-6 text-center text-lg font-semibold text-[#22a7d3]">{projectName}</p>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={pending}
              className="w-full rounded-lg border border-white/10 px-3.5 py-2.5 text-base text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3] disabled:opacity-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={pending}
              className="w-full rounded-lg border border-white/10 px-3.5 py-2.5 text-base text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3] disabled:opacity-50"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ComboboxInput
            label="Department"
            value={department}
            onChange={setDepartment}
            options={departmentSuggestions}
            placeholder="e.g. Audio, RF"
          />
          <ComboboxInput
            label="Position"
            value={position}
            onChange={setPosition}
            options={positionSuggestions}
            placeholder="e.g. A1, PLHQ"
          />
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={pending || !firstName.trim() || !lastName.trim()}
          className="w-full rounded-lg bg-[#0178a3] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Submit'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="w-full rounded-lg py-2 text-sm font-medium text-gray-400 transition-colors hover:text-white"
        >
          Cancel
        </button>
      </form>
    </div>
  )
}

function PhoneReadyView({
  firstName,
  onContinue,
}: {
  firstName: string
  onContinue: () => void
}) {
  const [secondsLeft, setSecondsLeft] = useState(PHONE_READY_SECONDS)

  // Park onContinue in a ref so the auto-advance effect can run with an
  // empty dep array. Without this, the parent's router.refresh() poll
  // (every 4s) re-creates the inline onContinue arrow, which used to
  // cancel + reset the setTimeout below — the 5s countdown would
  // visually reach 0 but never actually fire onContinue.
  const onContinueRef = useRef(onContinue)
  useEffect(() => {
    onContinueRef.current = onContinue
  }, [onContinue])

  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    const expire = setTimeout(() => {
      onContinueRef.current()
    }, PHONE_READY_SECONDS * 1000)
    return () => {
      clearInterval(tick)
      clearTimeout(expire)
    }
  }, [])

  return (
    <div className="mx-auto w-full max-w-sm text-center">
      <h2 className="mb-3 text-2xl font-semibold text-white">
        You&rsquo;re in, {firstName}!
      </h2>
      <p className="mb-8 text-base text-gray-300">
        Get your phone out and use your camera to scan the QR link —
        it&rsquo;ll appear in a few seconds.
      </p>
      <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-[#0178a3]/20 text-[#22a7d3]">
        <svg
          className="size-10"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.5 1.875h3a.75.75 0 0 1 .75.75v.375a.375.375 0 0 1-.375.375h-3.75a.375.375 0 0 1-.375-.375V2.625a.75.75 0 0 1 .75-.75ZM7.5 4.5h9a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 21V6a1.5 1.5 0 0 1 1.5-1.5Zm3.75 14.625h1.5"
          />
        </svg>
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="relative w-full overflow-hidden rounded-lg bg-[#0178a3] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7]"
      >
        <span className="relative z-10">Show QR · {secondsLeft}s</span>
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-1000 ease-linear"
          style={{ width: `${(secondsLeft / PHONE_READY_SECONDS) * 100}%` }}
        />
      </button>
    </div>
  )
}

function QrView({
  firstName,
  lastName,
  joinUrl,
  onDone,
}: {
  firstName: string
  lastName: string
  joinUrl: string
  onDone: () => void
}) {
  const [secondsLeft, setSecondsLeft] = useState(QR_COUNTDOWN_SECONDS)

  // Same ref-pin trick as PhoneReadyView: the parent re-renders every
  // 4s on router.refresh(), which used to keep canceling + restarting
  // this 15s timeout. Pin onDone in a ref so the effect can run with
  // empty deps and the timer actually expires.
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    const expire = setTimeout(() => {
      onDoneRef.current()
    }, QR_COUNTDOWN_SECONDS * 1000)
    return () => {
      clearInterval(tick)
      clearTimeout(expire)
    }
  }, [])

  return (
    <div className="mx-auto w-full max-w-sm">
      <h2 className="mb-2 text-center text-xl font-semibold text-white">
        {firstName} {lastName}
      </h2>
      <p className="mb-6 text-center text-xs text-gray-500">
        Scan with your phone, then set your 4-digit PIN
      </p>
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-2xl bg-white p-4">
          <QRCodeSVG value={joinUrl} size={220} level="M" />
        </div>
        <a
          href={joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-center font-mono text-[10px] text-gray-500 hover:text-gray-300"
        >
          {joinUrl}
        </a>
      </div>
      <button
        type="button"
        onClick={onDone}
        className="relative mt-8 w-full overflow-hidden rounded-lg bg-[#0178a3] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7]"
      >
        <span className="relative z-10">Done · {secondsLeft}s</span>
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-1000 ease-linear"
          style={{ width: `${(secondsLeft / QR_COUNTDOWN_SECONDS) * 100}%` }}
        />
      </button>
    </div>
  )
}
