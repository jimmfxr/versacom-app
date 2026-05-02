'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Like useState but persists the value in sessionStorage under `key` so it
 * survives client-side navigation (e.g. dashboard → project → back). Falls
 * back to `initial` on first mount if the key is empty or storage isn't
 * available (SSR, private mode, etc.).
 *
 * Used for filter chips that should "remember" what the user picked when
 * they navigate around the app.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValueState] = useState<T>(initial)
  const hydrated = useRef(false)

  // Hydrate from sessionStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = sessionStorage.getItem(key)
      if (raw !== null) setValueState(JSON.parse(raw) as T)
    } catch {
      // Storage may be unavailable; keep initial.
    }
    hydrated.current = true
  }, [key])

  function setValue(next: T | ((prev: T) => T)) {
    setValueState((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      try {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(key, JSON.stringify(resolved))
        }
      } catch {
        // Ignore storage errors.
      }
      return resolved
    })
  }

  return [value, setValue]
}
