'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'
import { EmptyState } from '@/components/empty-state'

const DEPLOY_STATUSES = [
  { value: 'na', label: 'N/A' },
  { value: 'deployed', label: 'Deployed' },
  { value: 'done', label: 'Done' },
  { value: 'returned', label: 'Returned' },
  { value: 'not-needed', label: 'Not Needed' },
  { value: 'damaged', label: 'Damaged' },
] as const

const STATUS_BADGE_STYLES: Record<string, string> = {
  na: 'bg-gray-500/15 text-gray-400',
  deployed: 'bg-green-500/15 text-green-400',
  done: 'bg-blue-500/15 text-blue-400',
  returned: 'bg-purple-500/15 text-purple-400',
  'not-needed': 'bg-yellow-500/15 text-yellow-400',
  damaged: 'bg-red-500/15 text-red-400',
}

const PANEL_CATEGORIES = ['panels', 'hardwire_bp', 'wireless_bp']

type EquipmentItem = {
  id: number
  name: string
  category: string
  hardwareType: string | null
  location: string | null
  headsetType: string | null
  ipAddress: string | null
  deployStatus: string
  projectId: number
  projectName: string
  userRole: string
}

function WrenchIcon() {
  return (
    <svg className="mx-auto size-12 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
    </svg>
  )
}

export function MyEquipmentContent({
  userName,
  isAdmin = false,
  isUserOnly = false,
  equipment,
}: {
  userName: string
  isAdmin?: boolean
  isUserOnly?: boolean
  equipment: EquipmentItem[]
}) {
  const router = useRouter()
  const isPanelType = (cat: string) => PANEL_CATEGORIES.includes(cat)
  const canEditPanel = (role: string) => ['crew', 'manager', 'admin'].includes(role)

  // Auto-refresh to pick up approved changes
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh()
    }, 2000)
    return () => clearInterval(interval)
  }, [router])

  return (
    <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} showMyEquipment={!isUserOnly}>
      <PageLayout title="My Equipment">
        <p className="text-xs text-gray-500">
          {equipment.length} item{equipment.length !== 1 ? 's' : ''} assigned to you
        </p>

        {equipment.length === 0 ? (
          <EmptyState
            icon={<WrenchIcon />}
            title="No equipment assigned"
            message="You don't have any equipment assigned to you yet."
          />
        ) : (
          <div className="space-y-2">
            {equipment.map((item) => {
              const hasPanel = isPanelType(item.category)
              const canEdit = hasPanel && canEditPanel(item.userRole)
              return (
                <div
                  key={item.id}
                  className={`flex items-start gap-4 rounded-2xl bg-[#2a2a2a] px-5 py-4 transition-colors ${hasPanel ? 'cursor-pointer hover:bg-[#313131]' : ''}`}
                  onClick={hasPanel ? () => router.push(`/projects/${item.projectId}/panel/${item.id}`) : undefined}
                >
                  <div className="min-w-0 flex-1">
                    {/* Row 1: ID, project, and edit badge */}
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span className="text-xs font-semibold text-gray-400">{item.name}</span>
                      <span className="text-gray-500">·</span>
                      <span className="text-xs text-[#0178a3]">{item.projectName}</span>
                      {hasPanel && (
                        <span className="rounded bg-[#0178a3]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#22a7d3]">
                          {canEdit ? 'Edit Panel' : 'View Panel'}
                        </span>
                      )}
                    </div>

                    {/* Row 2: Details */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-400">
                      {item.location && (
                        <>
                          <span className="hidden sm:inline text-gray-500">Location: </span>
                          <span>{item.location}</span>
                          <span className="text-gray-500">·</span>
                        </>
                      )}
                      {item.hardwareType && (
                        <>
                          <span className="hidden sm:inline text-gray-500">Hardware: </span>
                          <span>{item.hardwareType}</span>
                        </>
                      )}
                      {item.headsetType && (
                        <>
                          <span className="text-gray-500">·</span>
                          <span className="hidden sm:inline text-gray-500">Headset: </span>
                          <span>{item.headsetType}</span>
                        </>
                      )}
                      {item.ipAddress && (
                        <>
                          <span className="text-gray-500">·</span>
                          <span className="hidden sm:inline text-gray-500">IP: </span>
                          <a href={`http://${item.ipAddress}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#22a7d3] underline decoration-[#22a7d3]/30 hover:decoration-[#22a7d3]" onClick={(e) => e.stopPropagation()}>{item.ipAddress}</a>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status badge (read-only) */}
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_STYLES[item.deployStatus] || STATUS_BADGE_STYLES.na}`}
                  >
                    {DEPLOY_STATUSES.find((s) => s.value === item.deployStatus)?.label || 'N/A'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </PageLayout>
    </AppShell>
  )
}
