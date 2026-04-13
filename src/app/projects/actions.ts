'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'

async function generateUniqueProjectPin(): Promise<string> {
  let pin: string
  let exists = true
  while (exists) {
    pin = String(Math.floor(1000 + Math.random() * 9000))
    const dup = await prisma.project.findUnique({ where: { pin } })
    exists = dup !== null
  }
  return pin!
}

export async function createProject(formData: FormData) {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')

  if (!sessionCookie?.value) {
    return { error: 'Not authenticated' }
  }

  let session: { user: { id: number } }
  try {
    session = JSON.parse(sessionCookie.value)
  } catch {
    return { error: 'Invalid session' }
  }

  const name = formData.get('name') as string | null

  if (!name || name.trim().length === 0) {
    return { error: 'Project name is required' }
  }

  if (name.trim().length > 100) {
    return { error: 'Project name must be 100 characters or less' }
  }

  const existing = await prisma.project.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
  })
  if (existing) {
    return { error: 'A project with that name already exists' }
  }

  const pin = await generateUniqueProjectPin()

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      pin,
      createdById: session.user.id,
      members: {
        create: { userId: session.user.id, role: 'admin' },
      },
    },
    select: { id: true, name: true },
  })

  revalidatePath('/projects')
  return { success: true, name: project.name }
}
