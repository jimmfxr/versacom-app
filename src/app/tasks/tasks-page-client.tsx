'use client'

import { useState } from 'react'
import { PageLayout } from '@/components/page-layout'
import { EmptyState } from '@/components/empty-state'
import { TaskCardList, type TaskCard, type GearItem } from './task-card-list'
import { ProjectSwitcher } from '@/app/project-dashboard'

function CheckIcon() {
  return (
    <svg className="size-12 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

export function TasksPageClient({
  cards,
  allGear,
  locations,
  userProjects,
  validFilteredId,
  selectedProjectName,
  plots = [],
}: {
  cards: TaskCard[]
  allGear: GearItem[]
  locations: string[]
  userProjects: Array<{ id: number; name: string }>
  validFilteredId: number | null
  selectedProjectName: string | null
  plots?: Array<{ id: number; label: string; url: string }>
}) {
  const [search, setSearch] = useState('')
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  // Desktop search lives next to the chips row inside TaskCardList now,
  // not in the page header. Only the mobile collapsible search button
  // remains in the header on small screens.
  const mobileSearchToggle = !mobileSearchOpen && (
    <button
      type="button"
      onClick={() => setMobileSearchOpen(true)}
      aria-label="Search"
      className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white sm:hidden"
    >
      <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.343-4.343m0 0A8 8 0 1 0 5.343 5.343a8 8 0 0 0 11.314 11.314Z" />
      </svg>
    </button>
  )

  // Always render the project switcher when we have a valid project
  // (even for crew with a single project) — the dropdown should be
  // present in the header for visual consistency with other pages.
  const projectSwitcher = validFilteredId != null && selectedProjectName ? (
    <ProjectSwitcher
      projectId={validFilteredId}
      projectName={selectedProjectName}
      userProjects={userProjects}
      basePath="/tasks"
    />
  ) : null

  return (
    <PageLayout
      title="Tasks"
      titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
      stickyHeader
      bottomBorder
      action={
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="min-w-0 flex-1 sm:flex-initial">
            {projectSwitcher}
          </div>
          {mobileSearchToggle}
        </div>
      }
    >
      {/* Mobile-only collapsible search row — opens when the search
          icon to the right of the project dropdown is tapped. */}
      {mobileSearchOpen && (
        <div className="mb-3 flex items-center gap-2 sm:hidden">
          <input
            type="text"
            autoFocus
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full flex-1 rounded-lg border border-white/10 px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white focus:border-[#0178a3]"
          />
          <button
            type="button"
            onClick={() => { setMobileSearchOpen(false); setSearch('') }}
            aria-label="Close search"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
          >
            <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {cards.length === 0 ? (
        <EmptyState
          icon={<CheckIcon />}
          title="Inbox zero"
          message="No equipment waiting to be deployed. New tasks show up here as gear gets assigned or located."
        />
      ) : (
        <TaskCardList
          tasks={cards}
          allGear={allGear}
          locations={locations}
          searchValue={search}
          onSearchChange={setSearch}
          plots={plots}
        />
      )}
    </PageLayout>
  )
}
