'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { createKioskMember, updatePendingMember } from './actions'

const QR_COUNTDOWN_SECONDS = 20

type PendingMember = {
  id: number
  firstName: string
  lastName: string
  position: string | null
}

type KioskView =
  | { kind: 'form' }
  | { kind: 'edit'; member: PendingMember }
  | { kind: 'qr'; firstName: string; lastName: string; joinUrl: string }

export function KioskClient({
  projectId,
  projectName,
  pending,
}: {
  projectId: number
  projectName: string
  pending: PendingMember[]
}) {
  const router = useRouter()
  const [view, setView] = useState<KioskView>({ kind: 'form' })

  function close() {
    router.push(`/projects/${projectId}`)
  }

  return (
    <div className="relative min-h-screen bg-[#202020] px-4 py-10 sm:py-16">
      {/* Close (returns to project Team tab) */}
      <button
        type="button"
        onClick={close}
        aria-label="Close kiosk"
        className="absolute right-4 top-4 rounded-md p-2 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white sm:right-6 sm:top-6"
      >
        <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Logo */}
      <div className="mb-10 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/clair_logo_white.png" alt="Clair" className="h-16 w-auto" />
      </div>

      {view.kind === 'form' && (
        <FormView
          projectId={projectId}
          projectName={projectName}
          onCreated={(r) => setView({ kind: 'qr', ...r })}
          pending={pending}
          onPickPending={(m) => setView({ kind: 'edit', member: m })}
        />
      )}

      {view.kind === 'edit' && (
        <EditView
          member={view.member}
          onSaved={(r) => setView({ kind: 'qr', ...r })}
          onCancel={() => setView({ kind: 'form' })}
        />
      )}

      {view.kind === 'qr' && (
        <QrView
          firstName={view.firstName}
          lastName={view.lastName}
          joinUrl={view.joinUrl}
          onDone={() => {
            setView({ kind: 'form' })
            // Refresh pending list so the just-added/just-edited member moves
            // out (or appears) without a manual reload.
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function FormView({
  projectId,
  projectName,
  pending,
  onCreated,
  onPickPending,
}: {
  projectId: number
  projectName: string
  pending: PendingMember[]
  onCreated: (r: { firstName: string; lastName: string; joinUrl: string }) => void
  onPickPending: (m: PendingMember) => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending2, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createKioskMember(projectId, firstName, lastName)
      if ('error' in res) {
        setError(res.error)
        return
      }
      setFirstName('')
      setLastName('')
      onCreated(res)
    })
  }

  return (
    <>
      {/* Add form — same width + style as login */}
      <div className="mx-auto w-full max-w-sm">
        <h2 className="mb-1 text-center text-xl font-semibold text-white">Add Crew</h2>
        <p className="mb-6 text-center text-xs text-gray-500">{projectName}</p>
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
                className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-3 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3] disabled:opacity-50"
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
                className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-3 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3] disabled:opacity-50"
              />
            </div>
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

      {/* Divider */}
      <div className="mx-auto my-10 max-w-3xl border-t border-white/[0.08]" />

      {/* Pending — full width container, capped wider for readability */}
      <div className="mx-auto w-full max-w-3xl">
        <h3 className="mb-4 text-center text-sm font-semibold uppercase tracking-wider text-gray-400">
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
          <div className="space-y-2">
            {pending.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPickPending(m)}
                className="flex w-full items-center justify-between gap-4 rounded-2xl bg-[#2a2a2a] px-5 py-4 text-left transition-colors hover:bg-[#313131]"
              >
                <div className="min-w-0">
                  <div className="text-base font-semibold text-white">
                    {m.firstName} {m.lastName}
                  </div>
                  {m.position && (
                    <div className="mt-0.5 text-sm text-[#22a7d3]">{m.position}</div>
                  )}
                </div>
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Edit →
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function EditView({
  member,
  onSaved,
  onCancel,
}: {
  member: PendingMember
  onSaved: (r: { firstName: string; lastName: string; joinUrl: string }) => void
  onCancel: () => void
}) {
  const [firstName, setFirstName] = useState(member.firstName)
  const [lastName, setLastName] = useState(member.lastName)
  const [position, setPosition] = useState(member.position ?? '')
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
      })
      if ('error' in res) {
        setError(res.error)
        return
      }
      onSaved(res)
    })
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h2 className="mb-6 text-center text-xl font-semibold text-white">Edit Crew</h2>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={pending}
              className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-3 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3] disabled:opacity-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={pending}
              className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-3 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3] disabled:opacity-50"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-400">Position</label>
          <input
            type="text"
            placeholder="e.g. A1, FOH, LBOP 1"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            disabled={pending}
            className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-3 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3] disabled:opacity-50"
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
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const expireRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    expireRef.current = setTimeout(() => {
      onDone()
    }, QR_COUNTDOWN_SECONDS * 1000)
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      if (expireRef.current) clearTimeout(expireRef.current)
    }
  }, [onDone])

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
