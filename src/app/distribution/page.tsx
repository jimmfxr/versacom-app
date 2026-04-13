import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { DistributionPicker } from './distribution-picker'

export default async function DistributionPage() {
  const projects = await prisma.project.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      name: true,
      _count: { select: { equipment: true } },
    },
    orderBy: { name: 'asc' },
  })

  // If only one project, go straight to it
  if (projects.length === 1) {
    redirect(`/projects/${projects[0].id}/distribution`)
  }

  return (
    <DistributionPicker
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        equipmentCount: p._count.equipment,
      }))}
    />
  )
}
