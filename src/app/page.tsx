'use client'

import { PlaceholderPanel } from '@/components/placeholder-panel'
import { AppShell } from '@/components/app-shell'
import { PageLayout } from '@/components/page-layout'

export default function HomePage() {
  return (
    <AppShell>
      <PageLayout title="Dashboard">
        <PlaceholderPanel />
      </PageLayout>
    </AppShell>
  )
}
