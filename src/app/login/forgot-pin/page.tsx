'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { resetPin } from './actions'

type Step = 'form' | 'done'

export default function ForgotPinPage() {
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState<Step>('form')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required')
      return
    }

    startTransition(async () => {
      const result = await resetPin(firstName.trim(), lastName.trim())
      if (result.error) {
        setError(result.error)
        return
      }
      setStep('done')
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#202020] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <Link href="/" aria-label="Back to home">
            <img src="/clair_logo_white.png" alt="Clair" className="h-16 w-auto transition-opacity hover:opacity-80" />
          </Link>
        </div>

        {step === 'form' ? (
          <>
            <h2 className="text-center text-xl font-semibold text-white">Reset Your PIN</h2>
            <p className="mt-2 text-center text-sm text-gray-400">
              Enter your name to reset your PIN. You'll need your project PIN to set a new one.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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
                    onChange={(e) => { setFirstName(e.target.value); setError('') }}
                    disabled={isPending}
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
                    onChange={(e) => { setLastName(e.target.value); setError('') }}
                    disabled={isPending}
                    className="w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-4 py-3 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3] disabled:opacity-50"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-xl bg-red-500/10 px-4 py-3 text-center">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isPending || !firstName.trim() || !lastName.trim()}
                className="w-full rounded-lg bg-[#0178a3] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#019bc7] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPending ? 'Resetting...' : 'Reset PIN'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <Link href="/login" className="text-sm text-[#0178a3] hover:text-[#019bc7] transition-colors">
                Back to Login
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15">
                <svg className="h-7 w-7 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-white">PIN Reset</h2>
              <p className="mt-3 text-sm text-gray-400">
                Your PIN has been cleared. To set a new one, join your project again using your project PIN.
              </p>
            </div>

            <div className="mt-8">
              <Link
                href="/login/join"
                className="block w-full rounded-lg bg-[#0178a3] py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-[#019bc7]"
              >
                Go to Join Project
              </Link>
            </div>

            <div className="mt-4 text-center">
              <Link href="/login" className="text-sm text-gray-500 hover:text-gray-400 transition-colors">
                Back to Login
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
