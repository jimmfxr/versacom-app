'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { usePushSubscription } from '@/hooks/use-push-subscription'
import { NOTIFICATION_TYPES, type NotificationType } from '@/lib/notification-types'
import { setNotificationPref } from './actions'

/**
 * Collapsible settings card at the top of /notifications. Header shows
 * the section label + the push subscribe/unsubscribe toggle so a user
 * can kill all push from one place. Expanded body lists every
 * notification kind the user could receive (filtered by admin scope) so
 * they can opt out of individual types — those rows are then skipped at
 * safeSend time for this user only; other recipients still get theirs.
 */
export function NotificationSettings({
  prefs,
  isAdminAnywhere,
}: {
  prefs: Record<string, boolean>
  isAdminAnywhere: boolean
}) {
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(true)
  const [isPending, startTransition] = useTransition()
  // Optimistic local copy so the toggle flips immediately on tap
  // instead of waiting on the server action + revalidate roundtrip.
  const [localPrefs, setLocalPrefs] = useState<Record<string, boolean>>(prefs)

  function isEnabled(type: NotificationType): boolean {
    // Missing row defaults to enabled.
    return localPrefs[type] !== false
  }

  function handleToggle(type: NotificationType) {
    const next = !isEnabled(type)
    setLocalPrefs((p) => ({ ...p, [type]: next }))
    startTransition(async () => {
      await setNotificationPref(type, next)
      router.refresh()
    })
  }

  const visibleTypes = (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).filter(
    (t) => NOTIFICATION_TYPES[t].scope === 'all' || isAdminAnywhere,
  )

  return (
    <div className="border-b border-white/10 py-4 sm:py-5">
      <div className="flex w-full items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 items-center justify-between gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Settings
            </div>
            <div className="text-base font-semibold text-white">Notification preferences</div>
          </div>
          <svg
            className={`size-4 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div className="mt-4 space-y-3">
          {/* Push subscribe row sits on top — it's the master switch:
              even if every type below is enabled, no buzz arrives until
              the browser is subscribed. Hidden on browsers / contexts
              that can't subscribe at all (Safari without PWA, etc.). */}
          <PushSubscribeRow />

          <div className="space-y-1">
            {visibleTypes.map((type) => {
              const def = NOTIFICATION_TYPES[type]
              const enabled = isEnabled(type)
              return (
                <div
                  key={type}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">{def.label}</div>
                    <div className="mt-0.5 text-xs text-gray-500">{def.description}</div>
                  </div>
                  <ToggleSwitch
                    enabled={enabled}
                    disabled={isPending}
                    onChange={() => handleToggle(type)}
                    label={def.label}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Browser-push subscribe/unsubscribe row. Renders nothing on
 *  unsupported / unconfigured browsers so the card doesn't surface a
 *  switch that can't ever do anything. */
function PushSubscribeRow() {
  const { state, enable, disable } = usePushSubscription()

  if (state.status === 'unsupported' || state.status === 'unconfigured') return null

  if (state.status === 'denied') {
    return (
      <div className="rounded-lg border border-white/[0.06] px-3 py-2.5">
        <div className="text-sm font-medium text-white">Push notifications</div>
        <div className="mt-0.5 text-xs text-gray-500">
          Blocked by your browser. Re-enable from site settings to receive push buzzes.
        </div>
      </div>
    )
  }

  const subscribed = state.status === 'idle' && state.subscribed
  const loading = state.status === 'loading'

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-white">Push notifications</div>
        <div className="mt-0.5 text-xs text-gray-500">
          {subscribed
            ? 'This device will buzz for any enabled type below.'
            : 'Turn on to receive push on this device.'}
        </div>
      </div>
      <ToggleSwitch
        enabled={subscribed}
        disabled={loading}
        onChange={() => (subscribed ? disable() : enable())}
        label="Push notifications"
      />
    </div>
  )
}

/** Pill-style on/off switch. Cyan when enabled, neutral when off —
 *  matches the rest of the app's chip system. */
function ToggleSwitch({
  enabled,
  disabled,
  onChange,
  label,
}: {
  enabled: boolean
  disabled?: boolean
  onChange: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        enabled ? 'bg-[#22a7d3]' : 'bg-white/15'
      }`}
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
