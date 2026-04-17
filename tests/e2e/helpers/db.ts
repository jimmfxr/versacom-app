import { neon } from '@neondatabase/serverless'
import bcrypt from 'bcryptjs'

const TEST_URL = process.env.TEST_DATABASE_URL
const PROD_URL = process.env.DATABASE_URL

if (!TEST_URL) {
  throw new Error(
    '[e2e] TEST_DATABASE_URL is not set. Add it to .env.test.local — it MUST point to a separate database (e.g. a Neon test branch) and MUST NOT equal your dev DATABASE_URL.',
  )
}

if (PROD_URL && TEST_URL === PROD_URL) {
  throw new Error(
    '[e2e] TEST_DATABASE_URL equals DATABASE_URL. Refusing to run tests against your dev database — set TEST_DATABASE_URL to a separate database.',
  )
}

const sql = neon(TEST_URL)

/**
 * Seed a self-contained scenario: one project, one admin, one crew, one panel
 * with 16 keys, and one pick list item the crew can assign.
 *
 * Uses raw SQL via @neondatabase/serverless so we don't have to load the
 * generated Prisma client (which is .ts source built for Next.js, not the
 * Playwright runner).
 */
export async function seedScenario(runId: string) {
  const adminFirst = `Etest${runId}`
  const adminLast = 'Admin'
  const crewFirst = `Etest${runId}`
  const crewLast = 'Crew'
  const projectName = `E2E Project ${runId}`
  const pin = '1234'
  const hashed = await bcrypt.hash(pin, 10)
  const projectPin = `9${runId.slice(-3)}`

  const [admin] = (await sql`
    INSERT INTO "User" ("firstName", "lastName", "pin", "updatedAt")
    VALUES (${adminFirst}, ${adminLast}, ${hashed}, NOW())
    RETURNING id
  `) as Array<{ id: number }>

  const [crew] = (await sql`
    INSERT INTO "User" ("firstName", "lastName", "pin", "updatedAt")
    VALUES (${crewFirst}, ${crewLast}, ${hashed}, NOW())
    RETURNING id
  `) as Array<{ id: number }>

  const [project] = (await sql`
    INSERT INTO "Project" ("name", "pin", "createdById", "updatedAt")
    VALUES (${projectName}, ${projectPin}, ${admin.id}, NOW())
    RETURNING id
  `) as Array<{ id: number }>

  const [adminMembership] = (await sql`
    INSERT INTO "ProjectMember" ("userId", "projectId", "role")
    VALUES (${admin.id}, ${project.id}, 'admin')
    RETURNING id
  `) as Array<{ id: number }>

  const [crewMembership] = (await sql`
    INSERT INTO "ProjectMember"
      ("userId", "projectId", "role", "position", "location", "hardwareType")
    VALUES
      (${crew.id}, ${project.id}, 'crew', 'A1', 'FOH', 'KP-5032')
    RETURNING id
  `) as Array<{ id: number }>

  const [equipment] = (await sql`
    INSERT INTO "Equipment"
      ("projectId", "assignedToId", "name", "category", "hardwareType")
    VALUES
      (${project.id}, ${crewMembership.id}, 'PNL 1', 'panels', 'KP-5032')
    RETURNING id
  `) as Array<{ id: number }>

  // Pre-create 16 empty keys
  for (let i = 0; i < 16; i++) {
    await sql`
      INSERT INTO "PanelKey" ("projectMemberId", "keyIndex", "page", "expansion")
      VALUES (${crewMembership.id}, ${i}, 'main', 0)
    `
  }

  const pickItemName = `E2E_PTP_${runId}`
  const [pickItem] = (await sql`
    INSERT INTO "PickListItem" ("projectId", "code", "name", "type")
    VALUES (${project.id}, 'C001', ${pickItemName}, 'PTP')
    RETURNING id
  `) as Array<{ id: number }>

  return {
    adminFirst,
    adminLast,
    crewFirst,
    crewLast,
    pin,
    projectId: project.id,
    projectName,
    equipmentId: equipment.id,
    crewMembershipId: crewMembership.id,
    adminMembershipId: adminMembership.id,
    pickItemId: pickItem.id,
    pickItemName,
    userIds: [admin.id, crew.id],
  }
}

/** Wipe every row we created for this scenario, in FK-safe order. */
export async function cleanupScenario(scenario: Awaited<ReturnType<typeof seedScenario>>) {
  const pid = scenario.projectId
  await sql`
    DELETE FROM "ChangeRequestItem"
    WHERE "changeRequestId" IN (SELECT id FROM "ChangeRequest" WHERE "projectId" = ${pid})
  `
  await sql`DELETE FROM "ChangeRequest" WHERE "projectId" = ${pid}`
  await sql`
    DELETE FROM "KeyDraft"
    WHERE "panelKeyId" IN (
      SELECT pk.id FROM "PanelKey" pk
      JOIN "ProjectMember" pm ON pm.id = pk."projectMemberId"
      WHERE pm."projectId" = ${pid}
    )
  `
  await sql`
    DELETE FROM "PanelKey"
    WHERE "projectMemberId" IN (SELECT id FROM "ProjectMember" WHERE "projectId" = ${pid})
  `
  await sql`DELETE FROM "Equipment" WHERE "projectId" = ${pid}`
  await sql`DELETE FROM "PickListItem" WHERE "projectId" = ${pid}`
  await sql`DELETE FROM "ProjectMember" WHERE "projectId" = ${pid}`
  await sql`DELETE FROM "AccessRequest" WHERE "projectId" = ${pid}`
  await sql`DELETE FROM "Project" WHERE id = ${pid}`
  await sql`DELETE FROM "User" WHERE id = ANY(${scenario.userIds}::int[])`
}

/** No-op for symmetry with the previous Prisma-based helper. */
export async function disconnectDb() {
  // neon() uses a stateless HTTP client; nothing to disconnect.
}
