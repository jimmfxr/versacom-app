// Send a test push notification to a specific user.
// Usage: npx tsx scripts/send-test-push.mts <userId> [title] [body]

import webpush from 'web-push'
import { neon } from '@neondatabase/serverless'

const userId = parseInt(process.argv[2] ?? '', 10)
if (!Number.isFinite(userId)) {
  console.error('usage: send-test-push.mts <userId> [title] [body]')
  process.exit(1)
}
const title = process.argv[3] ?? 'Test from Nodal Control'
const body = process.argv[4] ?? 'If you can read this, push works on this device.'

const PUBLIC = process.env.VAPID_PUBLIC_KEY!
const PRIVATE = process.env.VAPID_PRIVATE_KEY!
const SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:noreply@example.com'
webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE)

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!)

const subs = await sql`
  SELECT id, endpoint, p256dh, auth FROM "PushSubscription" WHERE "userId" = ${userId}
` as Array<{ id: number; endpoint: string; p256dh: string; auth: string }>

console.log(`found ${subs.length} subscriptions for userId=${userId}`)

const payload = JSON.stringify({ title, body, url: '/', tag: `test-${Date.now()}` })

for (const s of subs) {
  const host = (() => { try { return new URL(s.endpoint).host } catch { return s.endpoint } })()
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload,
    )
    console.log(`  ✓ sent to #${s.id} (${host})`)
  } catch (err) {
    const code = typeof err === 'object' && err && 'statusCode' in err
      ? (err as { statusCode?: number }).statusCode
      : null
    console.log(`  ✗ failed #${s.id} (${host}) statusCode=${code}`, err)
  }
}
