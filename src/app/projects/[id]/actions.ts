'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'

async function getSession() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')
  if (!sessionCookie?.value) return null
  try {
    return JSON.parse(sessionCookie.value) as { user: { id: number } }
  } catch {
    return null
  }
}

export async function updateProject(projectId: number, formData: FormData) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const name = (formData.get('name') as string)?.trim()
  const status = formData.get('status') as string
  const managerId = formData.get('managerId') as string

  if (!name || name.length === 0) {
    return { error: 'Project name is required' }
  }
  if (name.length > 100) {
    return { error: 'Project name must be 100 characters or less' }
  }
  if (status !== 'active' && status !== 'archived') {
    return { error: 'Invalid status' }
  }

  // Check for duplicate name (excluding this project)
  const existing = await prisma.project.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      id: { not: projectId },
    },
  })
  if (existing) {
    return { error: 'A project with that name already exists' }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { name, status },
  })

  // Update manager role if set
  if (managerId) {
    const mgrId = parseInt(managerId, 10)
    if (!isNaN(mgrId)) {
      // Remove manager role from current manager(s)
      await prisma.projectMember.updateMany({
        where: { projectId, role: 'manager' },
        data: { role: 'crew' },
      })
      // Set new manager
      await prisma.projectMember.updateMany({
        where: { projectId, userId: mgrId },
        data: { role: 'manager' },
      })
    }
  }

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/projects')
  return { success: true }
}

export async function removeMember(projectId: number, memberId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.projectMember.delete({
    where: { id: memberId },
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function deleteProject(projectId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  // A Project has a web of foreign-key children. Prisma won't let us delete
  // the Project row until every child is gone, so we wipe them in FK-safe
  // order inside a transaction — either everything dies or nothing does.
  //
  // Previously this only deleted ProjectMembers before calling
  // prisma.project.delete, which would silently fail if any other child
  // (PickListItem, Equipment, ChangeRequest, ...) existed, leaving an
  // orphan Project row with 0 members in the list.
  try {
    await prisma.$transaction([
      prisma.keyDraft.deleteMany({
        where: { panelKey: { projectMember: { projectId } } },
      }),
      prisma.changeRequestItem.deleteMany({
        where: { changeRequest: { projectId } },
      }),
      prisma.changeRequest.deleteMany({ where: { projectId } }),
      prisma.panelKey.deleteMany({
        where: { projectMember: { projectId } },
      }),
      prisma.pickListItem.deleteMany({ where: { projectId } }),
      prisma.equipment.deleteMany({ where: { projectId } }),
      prisma.accessRequest.deleteMany({ where: { projectId } }),
      prisma.rackSlot.deleteMany({
        where: { rackTemplate: { projectId } },
      }),
      prisma.rackTemplate.deleteMany({ where: { projectId } }),
      prisma.projectMember.deleteMany({ where: { projectId } }),
      prisma.project.delete({ where: { id: projectId } }),
    ])
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('deleteProject error:', msg, e)
    return { error: `Failed to delete project: ${msg}` }
  }

  revalidatePath('/projects')
  revalidatePath('/')
  revalidatePath('/admin')
  revalidatePath('/my-equipment')
  return { success: true }
}
