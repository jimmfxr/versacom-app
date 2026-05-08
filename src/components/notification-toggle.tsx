'use client'

import { usePushSubscription } from '@/hooks/use-push-subscription'

/**
 * Inline button suitable for placing inside a Headless UI MenuItem.
 * Shows the current subscription state and toggles it on click. Hidden
 * entirely when the browser is unsupported or VAPID is unconfigured —
 * we don't want to surface a button that can't ever do anything.
 */
export function NotificationToggle() {
  const { state, enable, disable } = usePushSubscription()

  if (state.status === 'unsupported' || state.status === 'unconfigured') return null

  if (state.status === 'denied') {
    return (
      <span
        className="block w-full px-4 py-2 text-left text-sm text-gray-500"
        title="Notifications were blocked. Re-enable from your browser site settings."
      >
        Notifications blocked
      </span>
    )
  }

  const subscribed = state.status === 'idle' && state.subscribed
  const loading = state.status === 'loading'

  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => (subscribed ? disable() : enable())}
      className="block w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-50"
    >
      {loading ? '…' : subscribed ? 'Disable notifications' : 'Enable notifications'}
    </button>
  )
}
