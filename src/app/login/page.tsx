'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

type LoginError =
  | { type: 'invalid'; message: string }
  | { type: 'locked'; message: string; minutesRemaining: number }

type SetupInfo = {
  firstName: string
  lastName: string
  projectId: number
  projectName: string
}

export default function LoginPage() {
  // Wrap in Suspense so useSearchParams() can be statically prerendered
  // (Next 16 requirement). Inner component reads the params.
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  )
}

function LoginPageInner() {
  const searchParams = useSearchParams()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  // Pre-fill name from kiosk QR / deep link so existing crew don't have
  // to re-type their name when scanning at the kiosk station.
  useEffect(() => {
    const fn = searchParams.get('firstName')
    if (fn) setFirstName(fn)
    const ln = searchParams.get('lastName')
    if (ln) setLastName(ln)
  }, [searchParams])
  const [pinDigits, setPinDigits] = useState(['', '', '', ''])
  const [error, setError] = useState<LoginError | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  // Step 2: create personal PIN
  const [setupInfo, setSetupInfo] = useState<SetupInfo | null>(null)
  const [newPinDigits, setNewPinDigits] = useState(['', '', '', ''])
  const [confirmPinDigits, setConfirmPinDigits] = useState(['', '', '', ''])
  const [setupError, setSetupError] = useState<string | null>(null)

  const pin = pinDigits.join('')
  const newPin = newPinDigits.join('')
  const confirmPin = confirmPinDigits.join('')

  function handlePinChange(index: number, value: string) {
    if (!/^\d?$/.test(value)) return
    const next = [...pinDigits]
    next[index] = value
    setPinDigits(next)
    setError(null)
    if (value && index < 3) {
      document.getElementById(`pin-${index + 1}`)?.focus()
    }
  }

  function handlePinKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      document.getElementById(`pin-${index - 1}`)?.focus()
    }
  }

  function handleNewPinChange(index: number, value: string) {
    if (!/^\d?$/.test(value)) return
    const next = [...newPinDigits]
    next[index] = value
    setNewPinDigits(next)
    setSetupError(null)
    if (value && index < 3) {
      document.getElementById(`new-pin-${index + 1}`)?.focus()
    }
  }

  function handleNewPinKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !newPinDigits[index] && index > 0) {
      document.getElementById(`new-pin-${index - 1}`)?.focus()
    }
  }

  function handleConfirmPinChange(index: number, value: string) {
    if (!/^\d?$/.test(value)) return
    const next = [...confirmPinDigits]
    next[index] = value
    setConfirmPinDigits(next)
    setSetupError(null)
    if (value && index < 3) {
      document.getElementById(`confirm-pin-${index + 1}`)?.focus()
    }
  }

  function handleConfirmPinKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !confirmPinDigits[index] && index > 0) {
      document.getElementById(`confirm-pin-${index - 1}`)?.focus()
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim() || pin.length !== 4) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), pin }),
      })

      const data = await res.json()

      if (res.status === 423) {
        setError({ type: 'locked', message: data.message, minutesRemaining: data.minutesRemaining })
        return
      }

      // User needs to create a personal PIN — show step 2
      if (data.needsSetup) {
        setSetupInfo({
          firstName: data.firstName,
          lastName: data.lastName,
          projectId: data.projectId,
          projectName: data.projectName,
        })
        return
      }

      // Wrong project PIN for empty-PIN user
      if (res.status === 403 && data.error === 'needsSetup') {
        setError({ type: 'invalid', message: data.message })
        setPinDigits(['', '', '', ''])
        return
      }

      if (!res.ok) {
        setError({ type: 'invalid', message: data.error })
        setPinDigits(['', '', '', ''])
        return
      }

      // Redirect based on role
      const isUserOnly = data.memberships?.every((m: { role: string }) => m.role === 'user')
      router.push(isUserOnly ? '/my-equipment' : '/')
    } catch {
      setError({ type: 'invalid', message: 'Something went wrong. Please try again.' })
      setPinDigits(['', '', '', ''])
    } finally {
      setLoading(false)
    }
  }

  async function handleSetupPin(e: React.FormEvent) {
    e.preventDefault()
    if (!setupInfo || newPin.length !== 4 || confirmPin.length !== 4) return

    if (newPin !== confirmPin) {
      setSetupError('PINs do not match')
      setConfirmPinDigits(['', '', '', ''])
      return
    }

    setLoading(true)
    setSetupError(null)

    try {
      const res = await fetch('/api/auth/setup-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: setupInfo.firstName,
          lastName: setupInfo.lastName,
          projectId: setupInfo.projectId,
          pin: newPin,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setSetupError(data.error || 'Something went wrong')
        return
      }

      // Auto-logged in — redirect based on role
      const isUserOnly = data.memberships?.every((m: { role: string }) => m.role === 'user')
      router.push(isUserOnly ? '/my-equipment' : '/')
    } catch {
      setSetupError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const pinBoxClass = 'h-14 flex-1 min-w-0 rounded-lg border border-white/10 text-center text-xl text-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3] disabled:opacity-50'

  // ─── Step 2: Create Personal PIN ───
  if (setupInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#202020] px-4">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-10">
            <Link href="/" aria-label="Back to home">
              <img src="/clair_logo_white.png" alt="Clair" className="h-16 w-auto transition-opacity hover:opacity-80" />
            </Link>
          </div>

          <div className="rounded-xl bg-[#0178a3]/10 px-4 py-3 mb-6 text-center">
            <p className="text-sm text-[#22a7d3]">
              Welcome to <span className="font-semibold">{setupInfo.projectName}</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">Create a personal 4-digit PIN to log in</p>
          </div>

          <form onSubmit={handleSetupPin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">New PIN</label>
              <div className="flex gap-3">
                {newPinDigits.map((digit, i) => (
                  <input
                    key={i}
                    id={`new-pin-${i}`}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleNewPinChange(i, e.target.value)}
                    onKeyDown={(e) => handleNewPinKeyDown(i, e)}
                    disabled={loading}
                    autoFocus={i === 0}
                    className={pinBoxClass}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Confirm PIN</label>
              <div className="flex gap-3">
                {confirmPinDigits.map((digit, i) => (
                  <input
                    key={i}
                    id={`confirm-pin-${i}`}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleConfirmPinChange(i, e.target.value)}
                    onKeyDown={(e) => handleConfirmPinKeyDown(i, e)}
                    disabled={loading}
                    className={pinBoxClass}
                  />
                ))}
              </div>
            </div>

            {setupError && (
              <div className="rounded-xl bg-red-500/10 px-4 py-3 text-center">
                <p className="text-sm text-red-400">{setupError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || newPin.length !== 4 || confirmPin.length !== 4}
              className="w-full rounded-lg bg-[#0178a3] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Setting up...' : 'Create PIN & Login'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-gray-500">
            Remember this PIN — you&apos;ll use it to log in next time.
          </p>
        </div>
      </div>
    )
  }

  // ─── Step 1: Login ───
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#202020] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <Link href="/" aria-label="Back to home">
            <img src="/clair_logo_white.png" alt="Clair" className="h-16 w-auto transition-opacity hover:opacity-80" />
          </Link>
        </div>

        <h2 className="text-center text-xl font-semibold text-white mb-6">Login</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* First Name + Last Name — same row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-400 mb-1">
                First Name
              </label>
              <input
                id="firstName"
                type="text"
                placeholder="First Name"
                value={firstName}
                onChange={(e) => { setFirstName(e.target.value); setError(null) }}
                disabled={loading}
                className="w-full rounded-lg border border-white/10 px-3.5 py-2.5 text-base text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3] disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="lastName" className="block text-sm font-medium text-gray-400 mb-1">
                Last Name
              </label>
              <input
                id="lastName"
                type="text"
                placeholder="Last Name"
                value={lastName}
                onChange={(e) => { setLastName(e.target.value); setError(null) }}
                disabled={loading}
                className="w-full rounded-lg border border-white/10 px-3.5 py-2.5 text-base text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3] disabled:opacity-50"
              />
            </div>
          </div>

          {/* PIN — 4 separate digit boxes */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">PIN</label>
            <div className="flex gap-3">
              {pinDigits.map((digit, i) => (
                <input
                  key={i}
                  id={`pin-${i}`}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={(e) => handlePinKeyDown(i, e)}
                  disabled={loading}
                  className={pinBoxClass}
                />
              ))}
            </div>
          </div>

          {/* Error States */}
          {error?.type === 'invalid' && (
            <div className="rounded-xl bg-red-500/10 px-4 py-3 text-center">
              <p className="text-sm text-red-400">{error.message}</p>
            </div>
          )}

          {error?.type === 'locked' && (
            <div className="rounded-xl bg-amber-500/10 px-4 py-4 text-center">
              <p className="text-sm font-semibold text-amber-400 mb-1">
                Account temporarily locked
              </p>
              <p className="text-xs text-amber-400/80 mb-2">
                Too many incorrect attempts. Your account will automatically unlock in{' '}
                <span className="font-bold">{error.minutesRemaining} minute{error.minutesRemaining !== 1 ? 's' : ''}</span>.
              </p>
              <p className="text-xs text-gray-400">
                Contact your admin to unlock your account immediately.
              </p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !firstName.trim() || !lastName.trim() || pin.length !== 4}
            className="w-full rounded-lg bg-[#0178a3] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Connecting...' : 'Login & Connect'}
          </button>
        </form>

        {/* Help text */}
        <p className="mt-6 text-center text-xs text-gray-500">
          First time? Enter your name and the project PIN your admin gave you.
        </p>

        {/* Links */}
        <div className="mt-6 space-y-3 text-center text-sm">
          <div>
            <a href="/login/forgot-pin" className="text-[#0178a3] hover:text-[#019bc7] transition-colors">
              Forgot PIN?
            </a>
          </div>
          <div>
            <a href="/login/join" className="text-[#0178a3] hover:text-[#019bc7] transition-colors">
              Need to request access? <span className="font-semibold">Join Project</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
