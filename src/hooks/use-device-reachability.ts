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

  useEffect(() => {
    mountedRef.current = true

    const ipItems = items.filter(
      (i): i is DeviceItem & { ipAddress: string } => !!i.ipAddress,
    )
    if (ipItems.length === 0) return

    async function checkAll() {
      const results: ReachabilityMap = {}

      await Promise.allSettled(
        ipItems.map(async (item) => {
          results[item.id] = await probeDevice(item.ipAddress)
        }),
      )

      if (mountedRef.current) {
        setReachable(results)
      }
    }

    checkAll()
    const timer = setInterval(checkAll, intervalMs)

    return () => {
      mountedRef.current = false
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipKey, intervalMs])

  return reachable
}
