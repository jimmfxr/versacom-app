import { PageHeader } from '@/components/page-header'

type PageLayoutProps = {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  /** Forwarded to PageHeader to override the default h1 class. */
  titleClassName?: string
  /** Forwarded to PageHeader: keep title + action on one row on mobile. */
  inlineAction?: boolean
  /** Slot rendered above the PageHeader (e.g. a back link). Aligned to the page gutter. */
  before?: React.ReactNode
}

export function PageLayout({ title, action, children, titleClassName, inlineAction, before }: PageLayoutProps) {
  return (
    <div className="py-5">
      {before && (
        <div className="mx-auto mb-2 max-w-7xl px-4 sm:px-6 lg:px-8">{before}</div>
      )}
      <PageHeader title={title} action={action} titleClassName={titleClassName} inlineAction={inlineAction} />
      <main>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  )
}
