import { PageHeader } from '@/components/page-header'

type PageLayoutProps = {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}

export function PageLayout({ title, action, children }: PageLayoutProps) {
  return (
    <div className="py-10">
      <PageHeader title={title} action={action} />
      <main>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  )
}
