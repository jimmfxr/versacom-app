'use client'

import { PageHeader } from '@/components/page-header'
import { PlaceholderPanel } from '@/components/placeholder-panel'
import { AppShell } from '@/components/app-shell'

export default function HomePage() {
  return (
    <AppShell>
      <div className="py-10">
        <PageHeader title="Dashboard" />
        <main>
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <PlaceholderPanel />
          </div>
        </main>
      </div>
    </AppShell>
  )
}
