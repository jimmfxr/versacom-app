// Diagnostic — list push subscriptions in the DB.
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!)

const rows = await sql`
  SELECT ps.id, ps."userId", ps.endpoint, ps."createdAt",
         u."firstName", u."lastName"
  FROM "PushSubscription" ps
  JOIN "User" u ON u.id = ps."userId"
  ORDER BY ps."createdAt" DESC
` as Array<{
  id: number
  userId: number
  endpoint: string
  createdAt: string | Date
  firstName: string
  lastName: string
}>

console.log(`subscriptions: ${rows.length}`)
for (const r of rows) {
  const host = (() => { try { return new URL(r.endpoint).host } catch { return r.endpoint } })()
  const created = typeof r.createdAt === 'string' ? r.createdAt : r.createdAt.toISOString()
  console.log(`  #${r.id} user=${r.firstName} ${r.lastName} (id=${r.userId}) host=${host} created=${created}`)
}
