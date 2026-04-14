'use client'

import { PlaceholderPanel } from '@/components/placeholder-panel'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'

export function HomeContent({ userName, isAdmin, isUserOnly }: { userName?: string; isAdmin?: boolean; isUserOnly?: boolean }) {
  return (
    <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly}>
      <PageLayout title="Dashboard">
        <PlaceholderPanel />
      </PageLayout>
    </AppShell>
  )
}
