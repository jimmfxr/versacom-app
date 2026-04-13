'use client'

import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'
import { RowCard } from '@/components/row-card'
import { EmptyState } from '@/components/empty-state'

type Project = {
  id: number
  name: string
  equipmentCount: number
}

function FolderIcon() {
  return (
    <svg className="size-12 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  )
}

export function DistributionPicker({ projects }: { projects: Project[] }) {
  const router = useRouter()

  return (
    <AppShell>
      <PageLayout title="Distribution">
        {projects.length === 0 ? (
          <EmptyState
            icon={<FolderIcon />}
            title="No active projects"
            message="Create a project first to manage equipment distribution."
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-gray-400">Select a show to manage equipment.</p>
            <div className="space-y-2">
              {projects.map((project) => (
                <RowCard key={project.id} onClick={() => router.push(`/projects/${project.id}/distribution`)}>
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#0178a3]/15">
                    <svg className="size-5 text-[#0178a3]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-white">{project.name}</span>
                    <div className="mt-1 text-xs text-gray-500">{project.equipmentCount} equipment</div>
                  </div>
                  <svg className="size-5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </RowCard>
              ))}
            </div>
          </>
        )}
      </PageLayout>
    </AppShell>
  )
}
