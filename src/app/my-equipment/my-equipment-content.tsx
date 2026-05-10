'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/page-layout'
import { EmptyState } from '@/components/empty-state'
import { STATUS_BORDER_STYLES, getStatusLabel } from '@/lib/deploy-status'
import { ProjectSwitcher } from '@/app/project-dashboard'
import { useBackgroundRefresh } from '@/hooks/use-background-refresh'

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

type BrowseProject = { id: number; name: string }
type BrowseMember = {
  /** Entry id = equipmentId. Each row is one device, so multi-device
   *  members appear once per device in the dropdown. */
  id: number
  memberId: number
  firstName: string
  lastName: string
  position: string | null
  displayName: string
  /** Human equipment name like "PNL 1" / "WLBP 3" — surfaced in the
   *  dropdown so admins know which panel each user is on. */
  equipmentName?: string | null
}

export function MyEquipmentContent({
  userName,
  isAdmin = false,
  isUserOnly = false,
  equipment,
  browseProjects,
  selectedProjectId,
  browseMembers,
  selectedMemberId,
  browseMemberLabel,
}: {
  userName: string
  isAdmin?: boolean
  isUserOnly?: boolean
  equipment: EquipmentItem[]
  /** When set, the page is in admin/manager browse mode and renders project
   *  + user switchers in the page header. */
  browseProjects?: BrowseProject[]
  selectedProjectId?: number
  browseMembers?: BrowseMember[]
  selectedMemberId?: number | null
  browseMemberLabel?: string
}) {
  const router = useRouter()
  const browseMode = !!browseProjects && browseProjects.length > 0

  // Prev / Next navigation through the browseMembers list. Wraps around.
  function jumpToMember(index: number) {
    if (!browseMembers || browseMembers.length === 0 || selectedProjectId == null) return
    const wrapped = ((index % browseMembers.length) + browseMembers.length) % browseMembers.length
    const next = browseMembers[wrapped]
    router.push(`/my-equipment?project=${selectedProjectId}&member=${next.id}`)
  }
  const currentMemberIndex = browseMembers && selectedMemberId != null
    ? browseMembers.findIndex((m) => m.id === selectedMemberId)
    : -1
  const isPanelType = (cat: string) => PANEL_CATEGORIES.includes(cat)
  // All non-admin roles edit through the request/approval flow; admin can
  // apply directly. Every role assigned a panel can open it for editing.
  const canEditPanel = (role: string) => ['user', 'crew', 'manager', 'admin'].includes(role)

  // Auto-refresh to pick up approved changes — switched to the shared
  // visibility-aware hook so the poll pauses when the tab isn't in the
  // foreground.
  useBackgroundRefresh(5000)

  return (
      <PageLayout
        title="My Equipment"
        titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
        bottomBorder
        action={
          browseMode && browseProjects && selectedProjectId != null ? (
            <ProjectSwitcher
              projectId={selectedProjectId}
              projectName={
                browseProjects.find((p) => p.id === selectedProjectId)?.name ?? '—'
              }
              userProjects={browseProjects}
              basePath="/my-equipment"
            />
          ) : null
        }
      >
        {/* Member switcher + prev/next steppers — moved out of the
            page header's action slot so the header height matches
            Dashboard / Tasks (one dropdown only). Sits on its own
            row directly below the divider. */}
        {browseMode && browseMembers && browseMembers.length > 0 && selectedProjectId != null && (
          <div className="-mt-6 mb-3 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => jumpToMember(currentMemberIndex - 1)}
              aria-label="Previous user"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white hover:text-white"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <MemberSwitcher
              members={browseMembers}
              selectedMemberId={selectedMemberId ?? null}
              selectedLabel={browseMemberLabel ?? '—'}
              onSelect={(id) => router.push(`/my-equipment?project=${selectedProjectId}&member=${id}`)}
            />
            <button
              type="button"
              onClick={() => jumpToMember(currentMemberIndex + 1)}
              aria-label="Next user"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white hover:text-white"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        )}
        <p className="mb-3 text-xs text-gray-500">
          {browseMode
            ? `${equipment.length} item${equipment.length !== 1 ? 's' : ''} assigned`
            : `${equipment.length} item${equipment.length !== 1 ? 's' : ''} assigned to you`}
        </p>

        {equipment.length === 0 ? (
          <EmptyState
            icon={<WrenchIcon />}
            title="No equipment assigned"
            message="You don't have any equipment assigned to you yet."
          />
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {equipment.map((item) => {
              const hasPanel = isPanelType(item.category)
              const canEdit = hasPanel && canEditPanel(item.userRole)
              return (
                <div
                  key={item.id}
                  // role=button + data-haptic so AppShell's global
                  // pointerdown listener fires navigator.vibrate(10).
                  // active:bg-white/[0.08] gives a subtle visual
                  // press state alongside the haptic so taps feel
                  // acknowledged on devices without vibration too.
                  role={hasPanel ? 'button' : undefined}
                  tabIndex={hasPanel ? 0 : undefined}
                  data-haptic={hasPanel ? 'true' : undefined}
                  className={`flex items-start gap-4 px-5 py-3 transition-colors ${hasPanel ? 'cursor-pointer hover:bg-white/[0.04] active:bg-white/[0.08]' : ''}`}
                  onClick={hasPanel ? () => {
                    // In browse mode (admin/manager) we tag the URL with
                    // ?from=my-equipment so the panel studio renders the
                    // dropdowns + prev/next + sibling-gear row, and so its
                    // back button returns here scoped to this user.
                    const url = browseMode
                      ? `/projects/${item.projectId}/panel/${item.id}?from=my-equipment`
                      : `/projects/${item.projectId}/panel/${item.id}`
                    router.push(url)
                  } : undefined}
                >
                  <div className="min-w-0 flex-1">
                    {/* Row 1: ID + edit badge. Project name is a
                        separate row on mobile (below ID) so the
                        narrow viewport doesn't squeeze the strip. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold">
                      <span className="text-xs font-semibold text-gray-400">{item.name}</span>
                      <span className="hidden text-gray-500 sm:inline">·</span>
                      <span className="hidden text-xs text-[#0178a3] sm:inline">{item.projectName}</span>
                      {hasPanel && (
                        <span className="rounded bg-[#0178a3]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#22a7d3]">
                          {canEdit ? 'Edit Panel' : 'View Panel'}
                        </span>
                      )}
                    </div>
                    {/* Project name on its own row on mobile only. */}
                    <div className="mt-0.5 text-xs text-[#0178a3] sm:hidden">{item.projectName}</div>

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
                          <a href={`http://${item.ipAddress}${item.category === 'panels' ? '/remote-control/' : ''}`} target="_blank" rel="noopener noreferrer" className="text-[#22a7d3] hover:text-[#019bc7]" onClick={(e) => e.stopPropagation()}>{item.ipAddress}</a>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status chip (read-only) — same chip chrome as
                      the deploy-status chips on Project Details:
                      rounded-lg, thin colored border, gray-200 label. */}
                  <span
                    className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-200 ${STATUS_BORDER_STYLES[item.deployStatus] || STATUS_BORDER_STYLES.na}`}
                  >
                    <span className="min-w-[4.5rem]">{getStatusLabel(item.deployStatus)}</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </PageLayout>
  )
}

function MemberSwitcher({
  members,
  selectedMemberId,
  selectedLabel,
  onSelect,
}: {
  members: BrowseMember[]
  selectedMemberId: number | null
  selectedLabel: string
  onSelect: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Build the trigger label from the selected member so we get the same
  // "ID · Name · Position" ordering as the dropdown rows. Falls back to
  // the parent-provided selectedLabel if no match (e.g. before hydration).
  const selectedMember = members.find((m) => m.id === selectedMemberId)
  const triggerLabel = selectedMember
    ? [selectedMember.equipmentName, selectedMember.displayName, selectedMember.position]
        .filter(Boolean)
        .join(' · ')
    : selectedLabel

  return (
    <div ref={ref} className="relative w-full sm:inline-block sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2.5 rounded-lg border-2 bg-[#202020] px-3.5 py-2 text-sm font-medium text-white transition-colors sm:min-w-[280px] ${
          open ? 'border-[#0178a3]' : 'border-white/10 hover:border-white/20'
        }`}
      >
        <span className="truncate">{triggerLabel}</span>
        <svg
          className={`size-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="5 8 10 13 15 8" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[320px] min-w-[260px] overflow-y-auto rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl">
          {members.map((m) => {
            const isActive = m.id === selectedMemberId
            // Equipment ID first (left), then name, then optional
            // position. Same ordering as the panel-studio browse member
            // dropdown for consistency.
            const label = [m.equipmentName, m.displayName, m.position]
              .filter(Boolean)
              .join(' · ')
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  if (!isActive) onSelect(m.id)
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                  isActive ? 'bg-[#0178a3]' : 'hover:bg-white/[0.06]'
                }`}
              >
                <span className={`text-[13px] font-medium ${isActive ? 'text-white' : 'text-gray-200'}`}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
