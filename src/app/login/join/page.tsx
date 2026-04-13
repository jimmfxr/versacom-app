'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { joinProject, createPersonalPin } from './actions'

type Step = 'join' | 'create-pin'

export default function JoinProjectPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Step state
  const [step, setStep] = useState<Step>('join')

  // Join form
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [projectPinDigits, setProjectPinDigits] = useState(['', '', '', ''])
  const [joinError, setJoinError] = useState('')

  // Create PIN form
  const [pinDigits, setPinDigits] = useState(['', '', '', ''])
  const [confirmPinDigits, setConfirmPinDigits] = useState(['', '', '', ''])
  const [pinError, setPinError] = useState('')
  const [projectName, setProjectName] = useState('')
  const [projectId, setProjectId] = useState(0)

  const projectPin = projectPinDigits.join('')
  const personalPin = pinDigits.join('')
  const confirmPin = confirmPinDigits.join('')

  function handleDigitChange(
    digits: string[],
    setDigits: (d: string[]) => void,
    index: number,
    value: string,
    prefix: string
  ) {
    if (!/^\d?$/.test(value)) return
    const next = [...digits]
    next[index] = value
    setDigits(next)
    setJoinError('')
    setPinError('')
    if (value && index < 3) {
      document.getElementById(`${prefix}-${index + 1}`)?.focus()
    }
  }

  function handleDigitKeyDown(
    digits: string[],
    prefix: string,
    index: number,
    e: React.KeyboardEvent
  ) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      document.getElementById(`${prefix}-${index - 1}`)?.focus()
    }
  }

  function handleJoinSubmit() {
    if (!firstName.trim() || !lastName.trim()) {
      setJoinError('First and last name are required')
      return
    }
    if (projectPin.length !== 4) {
      setJoinError('Enter the 4-digit project PIN')
      return
    }

    startTransition(async () => {
      const result = await joinProject(firstName.trim(), lastName.trim(), projectPin)
      if (result.error) {
        setJoinError(result.error)
        return
      }
      if (!result.needsPin) {
        // Existing user — added to project, go to login
        router.push('/login')
        return
      }
      // New user — need to create personal PIN
      setProjectName(result.projectName!)
      setProjectId(result.projectId!)
      setStep('create-pin')
    })
  }

  function handleCreatePin() {
    if (personalPin.length !== 4) {
      setPinError('Enter a 4-digit PIN')
      return
    }
    if (personalPin !== confirmPin) {
      setPinError('PINs do not match')
      return
    }

    startTransition(async () => {
      const result = await createPersonalPin(firstName.trim(), lastName.trim(), projectId, personalPin)
      if (result.error) {
        setPinError(result.error)
        return
      }
      router.push('/login')
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#202020] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <img src="/clair_logo_white.png" alt="Clair" className="h-16 w-auto" />
        </div>

        {step === 'join' ? (
          <>
            <h2 className="mt-8 text-center text-xl font-semibold text-white">Join a Project</h2>
            <p className="mt-2 text-center text-sm text-gray-400">
              Enter your name and the project PIN to join.
            </p>

            <div className="mt-8 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-300">
                    First name
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => { setFirstName(e.target.value); setJoinError('') }}
                    className="mt-1 w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-3 py-2.5 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
                  />
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-gray-300">
                    Last name
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => { setLastName(e.target.value); setJoinError('') }}
                    className="mt-1 w-full rounded-lg border-2 border-white/10 bg-[#2a2a2a] px-3 py-2.5 text-base text-white placeholder-gray-500 outline-none transition-colors focus:border-[#0178a3]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300">Project PIN</label>
                <div className="mt-1 flex gap-3">
                  {projectPinDigits.map((d, i) => (
                    <input
                      key={i}
                      id={`project-pin-${i}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={d}
                      onChange={(e) => handleDigitChange(projectPinDigits, setProjectPinDigits, i, e.target.value, 'project-pin')}
                      onKeyDown={(e) => handleDigitKeyDown(projectPinDigits, 'project-pin', i, e)}
                      className="h-14 flex-1 min-w-0 rounded-lg border-2 border-white/10 bg-[#2a2a2a] text-center text-xl text-white outline-none transition-colors focus:border-[#0178a3]"
                    />
                  ))}
                </div>
              </div>

              {joinError && (
                <p className="text-sm text-red-400">{joinError}</p>
              )}

              <button
                onClick={handleJoinSubmit}
                disabled={isPending}
                className="w-full rounded-lg bg-[#0178a3] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? 'Joining...' : 'Join Project'}
              </button>
            </div>

            <p className="mt-6 text-center text-sm text-gray-500">
              Already have an account?{' '}
              <Link href="/login" className="text-[#0178a3] hover:underline">
                Log in
              </Link>
            </p>
          </>
        ) : (
          <>
            <h2 className="mt-8 text-center text-xl font-semibold text-white">Create Your PIN</h2>
            <p className="mt-2 text-center text-sm text-gray-400">
              Welcome to <span className="text-white font-medium">{projectName}</span>! Create a personal 4-digit PIN you'll use to log in.
            </p>

            <div className="mt-8 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-300">Enter PIN</label>
                <div className="mt-1 flex gap-3">
                  {pinDigits.map((d, i) => (
                    <input
                      key={i}
                      id={`pin-${i}`}
                      type="password"
                      inputMode="numeric"
                      maxLength={1}
                      value={d}
                      onChange={(e) => handleDigitChange(pinDigits, setPinDigits, i, e.target.value, 'pin')}
                      onKeyDown={(e) => handleDigitKeyDown(pinDigits, 'pin', i, e)}
                      autoFocus={i === 0}
                      className="h-14 flex-1 min-w-0 rounded-lg border-2 border-white/10 bg-[#2a2a2a] text-center text-xl text-white outline-none transition-colors focus:border-[#0178a3]"
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300">Confirm PIN</label>
                <div className="mt-1 flex gap-3">
                  {confirmPinDigits.map((d, i) => (
                    <input
                      key={i}
                      id={`confirm-${i}`}
                      type="password"
                      inputMode="numeric"
                      maxLength={1}
                      value={d}
                      onChange={(e) => handleDigitChange(confirmPinDigits, setConfirmPinDigits, i, e.target.value, 'confirm')}
                      onKeyDown={(e) => handleDigitKeyDown(confirmPinDigits, 'confirm', i, e)}
                      className="h-14 flex-1 min-w-0 rounded-lg border-2 border-white/10 bg-[#2a2a2a] text-center text-xl text-white outline-none transition-colors focus:border-[#0178a3]"
                    />
                  ))}
                </div>
              </div>

              {pinError && (
                <p className="text-sm text-red-400">{pinError}</p>
              )}

              <button
                onClick={handleCreatePin}
                disabled={isPending}
                className="w-full rounded-lg bg-[#0178a3] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? 'Creating...' : 'Create PIN & Continue'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
