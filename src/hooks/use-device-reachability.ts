'use client'

import { useState, useEffect, useRef, useMemo } from 'react'

/**
 * Browser-side device reachability check.
 *
 * Probes each device IP via fetch + image fallback (both HTTPS and HTTP).
 * Only works when the user's device is on the **same network** as the
 * equipment. Off-site / cell-tower users see default (white) labels.
 */

type ReachabilityMap = Record<number, boolean>

interface DeviceItem {
  id: number
  ipAddress: string | null
}

const CACHE_KEY = 'device-reachability-cache'
// Short TTL keeps the "instant green on navigation" benefit without letting
// stale results linger when the user moves between networks (e.g. closing
// the laptop on-site and opening the phone at home).
const CACHE_TTL_MS = 10_000
const CHANNEL_NAME = 'device-reachability'

type CacheEntry = {
  ipKey: string
  checkedAt: number
  reachable: ReachabilityMap
}

type ChannelMessage = CacheEntry

function readCache(ipKey: string): ReachabilityMap | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    if (entry.ipKey !== ipKey) return null
    if (Date.now() - entry.checkedAt > CACHE_TTL_MS) return null
    return entry.reachable
  } catch {
    return null
  }
}

function writeCache(ipKey: string, reachable: ReachabilityMap): void {
  if (typeof window === 'undefined') return
  try {
    const entry: CacheEntry = { ipKey, checkedAt: Date.now(), reachable }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    // sessionStorage may be unavailable (private mode, quota); ignore
  }
}

/**
 * Minimum response time (ms) for a probe to count as success.
 *
 * Real panels on a LAN take ~10–300ms to respond (TCP handshake + HTTP +
 * possibly TLS). When the browser is OFF the production network, the OS
 * stack rejects the route almost instantly (<5ms) — and on mobile/Wi-Fi
 * that fast failure looks like a successful probe to fetch/img because
 * `no-cors` and `<img>` both fire success-looking events for any response,
 * including local network-stack errors.
 *
 * Gating on response time filters out those false positives without
 * affecting genuine slow LAN responses.
 */
const MIN_PROBE_MS = 25

/**
 * Try fetch with no-cors. Returns the elapsed time on resolve, or null if
 * the request errored / aborted before the timeout.
 */
async function fetchProbe(url: string, timeoutMs: number): Promise<number | null> {
  const signal = AbortSignal.timeout(timeoutMs)
  const start = performance.now()
  try {
    await fetch(url, { mode: 'no-cors', signal })
    return performance.now() - start
  } catch {
    return null
  }
}

/**
 * Try loading an image from the device. Returns whether the request settled
 * (loaded OR errored without timing out) and the elapsed time. The caller
 * decides whether the elapsed time is plausible for a real device.
 */
function imgProbe(url: string, timeoutMs: number): Promise<{ ok: boolean; ms: number }> {
  return new Promise((resolve) => {
    const start = performance.now()
    let settled = false
    const settle = (ok: boolean) => {
      if (!settled) { settled = true; resolve({ ok, ms: performance.now() - start }) }
    }

    const timer = setTimeout(() => {
      img.src = ''
      settle(false)
    }, timeoutMs)

    const img = new Image()
    img.onload = () => { clearTimeout(timer); settle(true) }
    img.onerror = () => { clearTimeout(timer); settle(true) }
    img.src = `${url}?_nc=${Date.now()}`
  })
}

async function probeDevice(ip: string): Promise<boolean> {
  // 1. Try fetch (HTTPS then HTTP) — fastest when it works
  for (const proto of ['https', 'http'] as const) {
    const ms = await fetchProbe(`${proto}://${ip}`, 3500)
    if (ms != null && ms >= MIN_PROBE_MS) {
      console.log(`[Reach] ${ip} ✓ (${proto} fetch, ${ms.toFixed(0)}ms)`)
      return true
    }
    if (ms != null) {
      console.log(`[Reach] ${ip} ⚠ ${proto} fetch returned in ${ms.toFixed(0)}ms — too fast, likely network reject`)
    }
  }

  // 2. Fallback: image probe (some devices respond to img but not no-cors fetch)
  for (const proto of ['http', 'https'] as const) {
    const { ok, ms } = await imgProbe(`${proto}://${ip}/favicon.ico`, 3500)
    if (ok && ms >= MIN_PROBE_MS) {
      console.log(`[Reach] ${ip} ✓ (${proto} img, ${ms.toFixed(0)}ms)`)
      return true
    }
    if (ok) {
      console.log(`[Reach] ${ip} ⚠ ${proto} img returned in ${ms.toFixed(0)}ms — too fast, likely network reject`)
    }
  }

  console.log(`[Reach] ${ip} ✗ unreachable`)
  return false
}

export function useDeviceReachability(
  items: DeviceItem[],
  intervalMs = 30_000,
): ReachabilityMap {
  const ipKey = useMemo(
    () =>
      items
        .filter((i) => i.ipAddress)
        .map((i) => `${i.id}:${i.ipAddress}`)
        .sort()
        .join(','),
    [items],
  )

  const [reachable, setReachable] = useState<ReachabilityMap>({})
  const lastCheckedAtRef = useRef(0)

  // Hydrate from sessionStorage on mount / when device list changes so
  // the IPs render in their last-known color instantly instead of going
  // white for a few seconds while we re-probe.
  useEffect(() => {
    const cached = readCache(ipKey)
    if (cached) setReachable(cached)
    else setReachable({})
  }, [ipKey])

  // Listen for results broadcast from other open tabs. When a sibling
  // tab finishes a probe round, adopt its results so we can skip the
  // next probe.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return
    let cancelled = false
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
      if (cancelled) return
      const msg = event.data
      if (!msg || msg.ipKey !== ipKey) return
      if (msg.checkedAt <= lastCheckedAtRef.current) return
      lastCheckedAtRef.current = msg.checkedAt
      setReachable(msg.reachable)
    }
    return () => {
      cancelled = true
      channel.close()
    }
  }, [ipKey])

  useEffect(() => {
    // Per-effect-run flag so an in-flight checkAll() from a previous run
    // can't write to a channel/state that's already been torn down.
    let cancelled = false

    const ipItems = items.filter(
      (i): i is DeviceItem & { ipAddress: string } => !!i.ipAddress,
    )
    if (ipItems.length === 0) return

    const channel =
      typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(CHANNEL_NAME)
        : null

    async function checkAll() {
      // If a sibling tab probed recently, skip — their broadcast already
      // updated us via the listener above.
      if (Date.now() - lastCheckedAtRef.current < intervalMs * 0.8) return

      const results: ReachabilityMap = {}

      await Promise.allSettled(
        ipItems.map(async (item) => {
          results[item.id] = await probeDevice(item.ipAddress)
        }),
      )

      if (cancelled) return
      const checkedAt = Date.now()
      lastCheckedAtRef.current = checkedAt
      setReachable(results)
      writeCache(ipKey, results)
      try {
        channel?.postMessage({ ipKey, checkedAt, reachable: results } satisfies ChannelMessage)
      } catch {
        // Channel may have been closed between the cancelled check and now;
        // safe to swallow — the next effect run owns its own channel.
      }
    }

    checkAll()
    const timer = setInterval(checkAll, intervalMs)

    return () => {
      cancelled = true
      clearInterval(timer)
      channel?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipKey, intervalMs])

  return reachable
}
