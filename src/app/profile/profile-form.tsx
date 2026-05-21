'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/page-layout'
import { updateProfile, changePin } from './actions'

/**
 * Profile editor. Desktop layout puts the avatar block on the left and
 * the edit fields on the right (two-column row); mobile collapses to a
 * single column with the avatar on top.
 *
 * Avatar upload is intentionally not wired yet — the field exists in
 * the schema but the UI just shows the initials medallion (same look
 * as the navbar). We'll add file upload once the prod DB migration
 * lands; until then editing the photo isn't safe to ship.
 */
export function ProfileForm({
  initial,
}: {
  initial: {
    firstName: string
    lastName: string
    position: string | null
    department: string | null
    email: string | null
    phone: string | null
    avatarUrl: string | null
  }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [firstName, setFirstName] = useState(initial.firstName)
  const [lastName, setLastName] = useState(initial.lastName)
  const [position, setPosition] = useState(initial.position ?? '')
  const [department, setDepartment] = useState(initial.department ?? '')
  const [email, setEmail] = useState(initial.email ?? '')
  const [phone, setPhone] = useState(initial.phone ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // ─── Change PIN section state ───────────────────────────────
  // Kept separate from the rest of the form because PIN changes need
  // current-PIN verification and a confirm field. Each save flows
  // through its own action so we don't bundle credential changes with
  // profile edits.
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinSaved, setPinSaved] = useState(false)
  const [pinPending, startPinTransition] = useTransition()
  // Collapsed by default — most users won't change their PIN often, so
  // the section sits as a tappable header that opens the three inputs.
  const [pinCollapsed, setPinCollapsed] = useState(true)
  // Personal-info section is collapsible too (matches the PIN section
  // pattern). Expanded by default since the page's primary purpose is
  // viewing/editing these fields — the user can collapse if they want
  // a cleaner stack.
  const [infoCollapsed, setInfoCollapsed] = useState(false)

  const dirty =
    firstName.trim() !== initial.firstName ||
    lastName.trim() !== initial.lastName ||
    position.trim() !== (initial.position ?? '') ||
    department.trim() !== (initial.department ?? '') ||
    email.trim() !== (initial.email ?? '') ||
    phone.trim() !== (initial.phone ?? '')

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await updateProfile({
        firstName,
        lastName,
        position: position.trim() === '' ? null : position,
        department: department.trim() === '' ? null : department,
        email: email.trim() === '' ? null : email,
        phone: phone.trim() === '' ? null : phone,
      })
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  function handlePinChange() {
    setPinError(null)
    setPinSaved(false)
    if (!/^\d{4}$/.test(currentPin)) {
      setPinError('Current PIN must be 4 digits')
      return
    }
    if (!/^\d{4}$/.test(newPin)) {
      setPinError('New PIN must be 4 digits')
      return
    }
    if (newPin !== confirmPin) {
      setPinError('New PIN and confirmation do not match')
      return
    }
    startPinTransition(async () => {
      const res = await changePin({ currentPin, newPin })
      if ('error' in res && res.error) {
        setPinError(res.error)
        return
      }
      setPinSaved(true)
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
    })
  }

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase()

  return (
    <PageLayout
      title="Profile"
      titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
      bottomBorder
    >
      {/* Two-column on desktop, single column on mobile. The avatar
          column gets a fixed width on desktop so the form column flexes
          to fill the rest. */}
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-10">
        <div className="flex flex-col items-center gap-3 sm:w-48 sm:shrink-0 sm:items-start">
          {initial.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              src={initial.avatarUrl}
              className="size-32 rounded-full object-cover outline -outline-offset-1 outline-white/10"
            />
          ) : (
            <span className="flex size-32 items-center justify-center rounded-full bg-[#0178a3] text-6xl font-semibold text-white outline -outline-offset-1 outline-white/10">
              {initials || '·'}
            </span>
          )}
          <div className="text-center text-xs text-gray-500 sm:text-left">
            Photo upload coming soon.
          </div>
          {/* Sign out lives with the avatar — it's an account action,
              not a profile-field edit. Compact chip-style so it doesn't
              compete with the Save / Update buttons on the right. */}
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white"
          >
            Sign out
          </button>
        </div>

        <div className="flex-1 space-y-4">
          {/* ─── Personal info ───────────────────────────────────
              Collapsible header (chevron + label) matching the PIN
              section below. Defaults collapsed so the page reads as a
              tidy stack of section toggles. */}
          <button
            type="button"
            onClick={() => setInfoCollapsed((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={!infoCollapsed}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Personal info
            </span>
            <svg
              className={`size-4 text-gray-400 transition-transform ${infoCollapsed ? '' : 'rotate-180'}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {!infoCollapsed && (<>
          {/* Mobile = 2 columns (wraps to 3 rows of 2 — first/last,
              department/position, email/phone). Desktop opens up to all
              6 fields on a single row. Department sits LEFT of Position
              by design — same ordering as the team-card edit form. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Field
              label="First name"
              value={firstName}
              onChange={setFirstName}
              disabled={isPending}
            />
            <Field
              label="Last name"
              value={lastName}
              onChange={setLastName}
              disabled={isPending}
            />
            <Field
              label="Department"
              placeholder="Audio, RF"
              value={department}
              onChange={setDepartment}
              disabled={isPending}
            />
            <Field
              label="Position"
              placeholder="A1, Comms Tech"
              value={position}
              onChange={setPosition}
              disabled={isPending}
            />
            <Field
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={setEmail}
              disabled={isPending}
            />
            <Field
              label="Phone"
              type="tel"
              placeholder="+1 555 555 5555"
              value={phone}
              onChange={setPhone}
              disabled={isPending}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
          {saved && !error && (
            <div className="rounded-lg border border-[#22a7d3]/40 bg-[#22a7d3]/10 px-3 py-2 text-sm text-[#22a7d3]">
              Saved
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || isPending}
              className="rounded-md border border-[#0178a3] bg-[#0178a3] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#019bc7] active:bg-[#015d80] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
          </>)}

          {/* ─── Change PIN ─────────────────────────────────────
              Collapsible — collapsed by default since most users
              won't rotate their PIN often. Tapping the header opens
              the three masked inputs + Update button. */}
          <div className="mt-4 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => setPinCollapsed((v) => !v)}
              className="flex w-full items-center justify-between gap-2 text-left"
              aria-expanded={!pinCollapsed}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Change PIN
              </span>
              <svg
                className={`size-4 text-gray-400 transition-transform ${pinCollapsed ? '' : 'rotate-180'}`}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {!pinCollapsed && (
              <div className="mt-3 space-y-3">
                {/* Mobile = 2 columns (current + new on row 1, confirm
                    alone on row 2); desktop opens to all three in one
                    row, matching the profile fields layout above. */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <PinField
                    label="Current PIN"
                    value={currentPin}
                    onChange={setCurrentPin}
                    disabled={pinPending}
                  />
                  <PinField
                    label="New PIN"
                    value={newPin}
                    onChange={setNewPin}
                    disabled={pinPending}
                  />
                  <PinField
                    label="Confirm new PIN"
                    value={confirmPin}
                    onChange={setConfirmPin}
                    disabled={pinPending}
                  />
                </div>

                {pinError && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {pinError}
                  </div>
                )}
                {pinSaved && !pinError && (
                  <div className="rounded-lg border border-[#22a7d3]/40 bg-[#22a7d3]/10 px-3 py-2 text-sm text-[#22a7d3]">
                    PIN updated
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handlePinChange}
                    disabled={
                      pinPending ||
                      currentPin.length !== 4 ||
                      newPin.length !== 4 ||
                      confirmPin.length !== 4
                    }
                    className="rounded-md border border-[#0178a3] bg-[#0178a3] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#019bc7] active:bg-[#015d80] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pinPending ? 'Updating…' : 'Update PIN'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  )
}

function Field({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
  type?: 'text' | 'email' | 'tel'
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="block w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[#0178a3] disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  )
}

/** 4-digit numeric input for PIN entry. Strips non-digits, caps at 4
 *  chars, and treats the value as a password so it's masked in the
 *  UI and not captured by browser autofill on adjacent text fields. */
function PinField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={4}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        disabled={disabled}
        className="block w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm tracking-[0.5em] text-white outline-none transition-colors focus:border-[#0178a3] disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  )
}
