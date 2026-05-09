import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!)
const rows = await sql`
  SELECT pp.id, pp."userId", pp."equipmentId", pp.state, pp."lastSeen",
         u."firstName", u."lastName", e.name AS equipment_name
  FROM "PanelPresence" pp
  JOIN "User" u ON u.id = pp."userId"
  JOIN "Equipment" e ON e.id = pp."equipmentId"
  ORDER BY pp."lastSeen" DESC
` as Array<{ id: number; userId: number; equipmentId: number; state: string; lastSeen: string; firstName: string; lastName: string; equipment_name: string }>
console.log(`presence rows: ${rows.length}`)
for (const r of rows) {
  console.log(`  user=${r.firstName} ${r.lastName} (id=${r.userId}) equipment=${r.equipment_name} (id=${r.equipmentId}) state=${r.state} lastSeen=${r.lastSeen}`)
}
