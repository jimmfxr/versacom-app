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

  // Search lives inside TaskCardList (above the cards list, like the
  // Projects page) — the page header carries just the project switcher.

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
      inlineAction
      action={
        // Mobile: project switcher fills the right half of the
        // header row next to the title. Desktop: content-sized so
        // the switcher's min-w-[280px] kicks in.
        <div className="flex w-1/2 justify-end sm:w-auto">
          {projectSwitcher}
        </div>
      }
    >
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
