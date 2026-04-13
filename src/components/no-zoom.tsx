'use client'

import { useEffect } from 'react'

export function NoZoom() {
  useEffect(() => {
    // Block Ctrl+scroll zoom on desktop
    function handleWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
      }
    }

    // Block Ctrl+Plus / Ctrl+Minus / Ctrl+0 zoom on desktop
    function handleKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault()
      }
    }

    // Block Safari pinch gesture on desktop
    function handleGesture(e: Event) {
      e.preventDefault()
    }

    document.addEventListener('wheel', handleWheel, { passive: false })
    document.addEventListener('keydown', handleKeydown)
    document.addEventListener('gesturestart', handleGesture)
    document.addEventListener('gesturechange', handleGesture)
    document.addEventListener('gestureend', handleGesture)

    return () => {
      document.removeEventListener('wheel', handleWheel)
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('gesturestart', handleGesture)
      document.removeEventListener('gesturechange', handleGesture)
      document.removeEventListener('gestureend', handleGesture)
    }
  }, [])

  return null
}
