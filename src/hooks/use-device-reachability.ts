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
const CACHE_TTL_MS = 60_000
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

/** Try fetch with no-cors — resolves if device answers, rejects otherwise. */
async function fetchProbe(url: string, timeoutMs: number): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs)
  await fetch(url, { mode: 'no-cors', signal })
}

/** Try loading an image from the device — resolves true if device answers. */
function imgProbe(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (v: boolean) => {
      if (!settled) { settled = true; resolve(v) }
    }

    const timer = setTimeout(() => {
      img.src = ''
      settle(false)
    }, timeoutMs)

    const img = new Image()
    img.onload = () => { clearTimeout(timer); settle(true) }
    img.onerror = () => {
      clearTimeout(timer)
      // onerror fires when the device responded with non-image content
      // (still proves the host is up). On truly unreachable hosts the
      // timeout fires instead.
      settle(true)
    }
    img.src = `${url}?_nc=${Date.now()}`
  })
}

async function probeDevice(ip: string): Promise<boolean> {
  // 1. Try fetch (HTTPS then HTTP) — fastest when it works
  for (const proto of ['https', 'http'] as const) {
    try {
      await fetchProbe(`${proto}://${ip}`, 3500)
      console.log(`[Reach] ${ip} ✓ (${proto} fetch)`)
      return true
    } catch {
      // continue to next attempt
    }
  }

  // 2. Fallback: image probe (some devices respond to img but not no-cors fetch)
  for (const proto of ['http', 'https'] as const) {
    const ok = await imgProbe(`${proto}://${ip}/favicon.ico`, 3500)
    if (ok) {
      console.log(`[Reach] ${ip} ✓ (${proto} img)`)
      return true
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
  const mountedRef = useRef(true)
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
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
      const msg = event.data
      if (!msg || msg.ipKey !== ipKey) return
      if (msg.checkedAt <= lastCheckedAtRef.current) return
      lastCheckedAtRef.current = msg.checkedAt
      if (mountedRef.current) setReachable(msg.reachable)
    }
    return () => channel.close()
  }, [ipKey])

  useEffect(() => {
    mountedRef.current = true

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

      if (!mountedRef.current) return
      const checkedAt = Date.now()
      lastCheckedAtRef.current = checkedAt
      setReachable(results)
      writeCache(ipKey, results)
      channel?.postMessage({ ipKey, checkedAt, reachable: results } satisfies ChannelMessage)
    }

    checkAll()
    const timer = setInterval(checkAll, intervalMs)

    return () => {
      mountedRef.current = false
      clearInterval(timer)
      channel?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipKey, intervalMs])

  return reachable
}
