import { config } from 'dotenv'
config({ path: '.env.local' })

import { neon } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from '../src/generated/prisma/client.js'
import bcrypt from 'bcryptjs'

const sql = neon(process.env.DATABASE_URL!)
const adapter = new PrismaNeon(sql)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding database...')

  // Clear existing data (order matters for FK constraints)
  await prisma.accessRequest.deleteMany()
  await prisma.changeRequestItem.deleteMany()
  await prisma.changeRequest.deleteMany()
  await prisma.keyDraft.deleteMany()
  await prisma.panelKey.deleteMany()
  await prisma.pickListItem.deleteMany()
  await prisma.nfgReport.deleteMany()
  await prisma.equipment.deleteMany()
  await prisma.rackSlot.deleteMany()
  await prisma.rackTemplate.deleteMany()
  await prisma.asset.deleteMany()
  await prisma.projectMember.deleteMany()
  await prisma.project.deleteMany()
  await prisma.user.deleteMany()

  // Create users with hashed PINs
  const adminPin = await bcrypt.hash('1234', 10)
  const crewPin1 = await bcrypt.hash('5678', 10)
  const crewPin2 = await bcrypt.hash('9012', 10)
  const userPin = await bcrypt.hash('3456', 10)

  const admin = await prisma.user.create({
    data: {
      firstName: 'Jimmy',
      lastName: 'Xiloj',
      pin: adminPin,
    },
  })

  const crew1 = await prisma.user.create({
    data: {
      firstName: 'Alex',
      lastName: 'Rivera',
      pin: crewPin1,
    },
  })

  const crew2 = await prisma.user.create({
    data: {
      firstName: 'Sam',
      lastName: 'Chen',
      pin: crewPin2,
    },
  })

  const user1 = await prisma.user.create({
    data: {
      firstName: 'Jordan',
      lastName: 'Wells',
      pin: userPin,
    },
  })

  // Create project
  const project = await prisma.project.create({
    data: {
      name: 'Grammy Awards 2026',
      status: 'active',
      createdById: admin.id,
    },
  })

  // Add members to project
  await prisma.projectMember.createMany({
    data: [
      {
        userId: admin.id,
        projectId: project.id,
        role: 'admin',
        position: 'PLHQ',
        location: 'FOH',
        hardwareType: 'RSP-1232',
        deployStatus: 'deployed',
      },
      {
        userId: crew1.id,
        projectId: project.id,
        role: 'crew',
        position: 'A1',
        location: 'FOH',
        hardwareType: 'RSP-1232',
        deployStatus: 'deployed',
      },
      {
        userId: crew2.id,
        projectId: project.id,
        role: 'crew',
        position: 'A2',
        location: 'MON',
        hardwareType: 'Bolero',
        deployStatus: 'holding',
      },
      {
        userId: user1.id,
        projectId: project.id,
        role: 'user',
        position: 'STAGE MGR',
        location: 'STAGE',
        hardwareType: 'Bolero',
        deployStatus: 'deployed',
      },
    ],
  })

  // Create some pick list items
  await prisma.pickListItem.createMany({
    data: [
      { projectId: project.id, name: 'PLHQ', type: 'PTP' },
      { projectId: project.id, name: 'A1', type: 'PTP' },
      { projectId: project.id, name: 'A2', type: 'PTP' },
      { projectId: project.id, name: 'Stage Mgr', type: 'PTP' },
      { projectId: project.id, name: 'ALL CALL', type: 'CONF' },
      { projectId: project.id, name: 'PROD', type: 'CONF' },
      { projectId: project.id, name: 'Camera', type: 'IFB' },
      { projectId: project.id, name: 'Band IFB', type: 'IFB' },
    ],
  })

  console.log('Seed complete!')
  console.log('')
  console.log('Test accounts:')
  console.log('  Admin:  Jimmy Xiloj    — PIN: 1234')
  console.log('  Crew:   Alex Rivera   — PIN: 5678')
  console.log('  Crew:   Sam Chen      — PIN: 9012')
  console.log('  User:   Jordan Wells  — PIN: 3456')
  console.log('')
  console.log(`Project: "${project.name}" (ID: ${project.id})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
