'use client'

import { useCallback, useEffect, useState } from 'react'

type State =
  | { status: 'unsupported' }
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'denied' }
  | { status: 'idle'; subscribed: boolean }

/**
 * Manages the user's Web Push subscription for the current device.
 *
 *   - `unsupported` — browser has no PushManager / Notification (Safari
 *     pre-iOS 16.4 in non-PWA mode).
 *   - `unconfigured` — server didn't return a public VAPID key.
 *   - `loading` — fetching VAPID / asking permission / hitting subscribe API.
 *   - `denied` — user previously declined notification permission.
 *   - `idle` + `subscribed: true|false` — ready, with current state.
 *
 * `enable()` requests permission (if needed), subscribes via the SW's
 * pushManager, and POSTs the subscription to /api/push/subscribe.
 * `disable()` unsubscribes the browser and POSTs to /api/push/unsubscribe.
 */
export function usePushSubscription() {
  const [state, setState] = useState<State>({ status: 'loading' })

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState({ status: 'unsupported' })
      return
    }
    if (Notification.permission === 'denied') {
      setState({ status: 'denied' })
      return
    }
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setState({ status: 'idle', subscribed: !!sub })
    } catch {
      setState({ status: 'idle', subscribed: false })
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const enable = useCallback(async () => {
    if (typeof window === 'undefined') return false
    setState({ status: 'loading' })
    try {
      // 1) Permission
      const perm = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()
      if (perm !== 'granted') {
        setState({ status: 'denied' })
        return false
      }

      // 2) VAPID public key from server
      const vapidRes = await fetch('/api/push/vapid')
      if (!vapidRes.ok) {
        setState({ status: 'unconfigured' })
        return false
      }
      const { publicKey } = (await vapidRes.json()) as { publicKey: string }

      // 3) Subscribe via the SW
      const reg = await navigator.serviceWorker.ready
      // Convert URL-safe base64 VAPID key to a fresh ArrayBuffer (TS
      // typings for `applicationServerKey` accept BufferSource — using
      // `.buffer` on a typed-array works at runtime; the cast keeps
      // the lib.dom.d.ts SharedArrayBuffer overlap happy).
      const keyBytes = urlBase64ToUint8Array(publicKey)
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer.slice(
          keyBytes.byteOffset,
          keyBytes.byteOffset + keyBytes.byteLength,
        ) as ArrayBuffer,
      })

      // 4) Send to server
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error('subscribe-failed')

      setState({ status: 'idle', subscribed: true })
      return true
    } catch (err) {
      console.warn('[push] enable failed', err)
      await refresh()
      return false
    }
  }, [refresh])

  const disable = useCallback(async () => {
    if (typeof window === 'undefined') return
    setState({ status: 'loading' })
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
      setState({ status: 'idle', subscribed: false })
    } catch {
      await refresh()
    }
  }, [refresh])

  return { state, enable, disable, refresh }
}

// VAPID public keys are URL-safe base64. The browser's pushManager
// expects them as Uint8Array. Standard converter.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary')
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}
