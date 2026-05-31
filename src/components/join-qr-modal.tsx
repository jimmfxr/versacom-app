'use client'

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Modal } from './modal'

/**
 * Standalone "Join via QR" modal — extracted from the legacy Navbar
 * so both the desktop top-bar chrome AND the mobile ToolsSheet can
 * mount it without duplicating the PIN-fetch + render logic.
 *
 * Fetches the project's join PIN lazily on `open` flipping true, so
 * the API call only fires when the operator actually asks for the
 * QR. Resets all state on close.
 */

type Props = {
  open: boolean
  onClose: () => void
  projectId: string | null
  projectName: string | null
}

export function JoinQrModal({ open, onClose, projectId, projectName }: Props) {
  const [loading, setLoading] = useState(false)
  const [pin, setPin] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch the PIN when the modal opens. Re-runs whenever the
  // (open, projectId) tuple changes so re-opening for a different
  // project doesn't surface the previous show's PIN.
  useEffect(() => {
    if (!open) return
    if (!projectId) {
      setError('No project context')
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setPin(null)
    fetch(`/api/projects/${projectId}/pin`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed (${res.status})`)
        const data = (await res.json()) as { pin: string }
        if (!cancelled) setPin(data.pin)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unable to load QR')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  function handleClose() {
    setPin(null)
    setError(null)
    onClose()
  }

  const joinUrl =
    pin != null ? `https://versacom-app.vercel.app/login/join?pin=${pin}` : null

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={projectName ? `Join — ${projectName}` : 'Join QR'}
    >
      {loading && (
        <div className="flex h-64 items-center justify-center text-sm text-gray-400">
          Loading…
        </div>
      )}
      {error && (
        <p className="py-4 text-center text-sm text-red-400">{error}</p>
      )}
      {!loading && !error && joinUrl && (
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="rounded-2xl bg-white p-4">
            <QRCodeSVG value={joinUrl} size={220} level="M" />
          </div>
          <span className="break-all text-center font-mono text-[11px] text-gray-400">
            {joinUrl}
          </span>
        </div>
      )}
    </Modal>
  )
}
