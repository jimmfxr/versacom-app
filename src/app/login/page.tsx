'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type LoginError =
  | { type: 'invalid'; message: string }
  | { type: 'locked'; message: string; minutesRemaining: number }

export default function LoginPage() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [pinDigits, setPinDigits] = useState(['', '', '', ''])
  const [error, setError] = useState<LoginError | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const pin = pinDigits.join('')

  function handlePinChange(index: number, value: string) {
    if (!/^\d?$/.test(value)) return
    const next = [...pinDigits]
    next[index] = value
    setPinDigits(next)
    setError(null)
    // Auto-focus next box
    if (value && index < 3) {
      const nextInput = document.getElementById(`pin-${index + 1}`)
      nextInput?.focus()
    }
  }

  function handlePinKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      const prevInput = document.getElementById(`pin-${index - 1}`)
      prevInput?.focus()
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
        setError({
          type: 'locked',
          message: data.message,
          minutesRemaining: data.minutesRemaining,
        })
        return
      }

      if (!res.ok) {
        setError({ type: 'invalid', message: data.error })
        setPinDigits(['', '', '', ''])
        return
      }

      router.push('/')
    } catch {
      setError({ type: 'invalid', message: 'Something went wrong. Please try again.' })
      setPinDigits(['', '', '', ''])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#202020] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <img src="/clair_logo_white.png" alt="Clair" className="h-16 w-auto" />
        </div>

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
                className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-3 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3] disabled:opacity-50"
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
                className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-3 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3] disabled:opacity-50"
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
                  className="h-14 flex-1 min-w-0 rounded-lg border-2 border-white/10 bg-[#2a2a2a] text-center text-xl text-white outline-none transition-colors focus:border-[#0178a3] disabled:opacity-50"
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
          Your 4-digit PIN was provided in your project approval email. Contact your admin if you need a new one.
        </p>

        {/* Links */}
        <div className="mt-6 flex justify-between text-sm">
          <a href="/login/join" className="text-[#0178a3] hover:text-[#019bc7] transition-colors">
            Need to request access? <span className="font-semibold">Join Project</span>
          </a>
          <a href="/login/forgot-pin" className="text-[#0178a3] hover:text-[#019bc7] transition-colors">
            Forgot PIN?
          </a>
        </div>
      </div>
    </div>
  )
}
