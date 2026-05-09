'use client'

import { useEffect, useRef, useState } from 'react'

export type PresenceViewer = {
  userId: number
  firstName: string
  lastName: string
  state: 'viewing' | 'editing'
}

const HEARTBEAT_INTERVAL_MS = 10_000
const POLL_INTERVAL_MS = 5_000

/**
 * Soft presence hook. While a Panel Studio page is mounted:
 *
 *  - Posts a heartbeat to /api/panel-presence/heartbeat every 10s
 *    (state = 'editing' if `editing` is true, else 'viewing').
 *  - Polls /api/panel-presence/list every 5s for the active list
 *    of OTHER viewers on this equipment.
 *  - ALSO fires an extra immediate heartbeat whenever `editing`
 *    flips, so the other side sees viewing→editing (or back) within
 *    one poll window instead of waiting up to 10s.
 *
 * Returns the latest viewer list. Failures are swallowed — presence
 * is informational, not load-bearing.
 */
export function usePanelPresence(equipmentId: number | null, editing: boolean) {
  const [viewers, setViewers] = useState<PresenceViewer[]>([])
  // editingRef so the heartbeat interval reads the latest value
  // without restarting whenever editing flips.
  const editingRef = useRef(editing)
  useEffect(() => {
    editingRef.current = editing
  }, [editing])

  // Outer heartbeat fn is a ref so we can call it from both the
  // interval and the `editing`-watcher effect below without depending
  // on its identity.
  const heartbeatRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    if (equipmentId == null) return
    if (typeof window === 'undefined') return
    let cancelled = false

    async function heartbeat() {
      try {
        await fetch('/api/panel-presence/heartbeat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            equipmentId,
            state: editingRef.current ? 'editing' : 'viewing',
          }),
          keepalive: true,
        })
      } catch {
        // network blip — next tick will retry
      }
    }
    heartbeatRef.current = heartbeat

    async function poll() {
      try {
        const res = await fetch(
          `/api/panel-presence/list?equipmentId=${equipmentId}`,
          { cache: 'no-store' },
        )
        if (!res.ok) return
        const data = (await res.json()) as { viewers: PresenceViewer[] }
        if (cancelled) return
        setViewers(data.viewers)
      } catch {
        // keep last good list
      }
    }

    void heartbeat()
    void poll()

    const hbId = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS)
    const pollId = window.setInterval(poll, POLL_INTERVAL_MS)

    // Explicit depart so the strip on the OTHER viewer's screen
    // disappears immediately when this user closes the tab,
    // navigates off the panel, or even just hides the tab. Uses
    // sendBeacon when available (the only fetch type the browser
    // reliably allows during page-unload), falls back to a regular
    // fetch with keepalive otherwise.
    function depart() {
      try {
        const body = JSON.stringify({ equipmentId })
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          // Blob with explicit MIME so the server reads it as JSON.
          const blob = new Blob([body], { type: 'application/json' })
          navigator.sendBeacon('/api/panel-presence/depart', blob)
          return
        }
        void fetch('/api/panel-presence/depart', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        })
      } catch {
        // best effort — the 15s stale window still cleans up if
        // depart fails.
      }
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') depart()
      else void heartbeat()
    }
    window.addEventListener('beforeunload', depart)
    window.addEventListener('pagehide', depart)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(hbId)
      window.clearInterval(pollId)
      window.removeEventListener('beforeunload', depart)
      window.removeEventListener('pagehide', depart)
      document.removeEventListener('visibilitychange', onVisibility)
      // Component-unmount path (router.push to another panel) —
      // also tell the server we're leaving so the previous panel's
      // viewers see us drop off right away.
      depart()
    }
  }, [equipmentId])

  // Fire an immediate heartbeat the moment `editing` flips so other
  // viewers see the state change on their next poll instead of having
  // to wait up to a full HEARTBEAT_INTERVAL_MS.
  useEffect(() => {
    if (equipmentId == null) return
    void heartbeatRef.current()
  }, [editing, equipmentId])

  return viewers
}
