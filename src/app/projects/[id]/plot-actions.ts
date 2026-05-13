'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

/**
 * Create a new plot on a project. Plot is just a label + an external
 * URL (typically a Google Drive share link). The PDF itself lives
 * wherever the URL points — nothing is uploaded to our storage.
 */
export async function createPlot(
  projectId: number,
  data: { label: string; url: string },
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const label = data.label.trim()
  const url = data.url.trim()
  if (!label) return { error: 'Label is required' }
  if (!url) return { error: 'URL is required' }

  await prisma.plot.create({
    data: { projectId, label, url },
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

/** Patch an existing plot — either field can be omitted to leave it
 *  unchanged. Both end up stored after `.trim()`. */
export async function updatePlot(
  projectId: number,
  plotId: number,
  data: { label?: string; url?: string },
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const patch: { label?: string; url?: string } = {}
  if (data.label !== undefined) {
    const trimmed = data.label.trim()
    if (!trimmed) return { error: 'Label is required' }
    patch.label = trimmed
  }
  if (data.url !== undefined) {
    const trimmed = data.url.trim()
    if (!trimmed) return { error: 'URL is required' }
    patch.url = trimmed
  }
  if (Object.keys(patch).length === 0) return { success: true }

  await prisma.plot.update({
    where: { id: plotId },
    data: patch,
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

/** Delete a plot row. Cascade settings ensure no orphans. */
export async function deletePlot(projectId: number, plotId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.plot.delete({ where: { id: plotId } })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}
