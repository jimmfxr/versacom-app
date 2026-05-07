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
  /**
   * On desktop (sm+) pin the page header (back link + title + action) just
   * below the global navbar so it stays in view as content scrolls. Pages
   * that opt in are responsible for placing any subsequent sticky elements
   * (tab strips, filter chips) at the correct top offset to stack below.
   * Mobile behavior is unchanged regardless.
   */
  stickyHeader?: boolean
  /** Forwarded to PageHeader: thin divider under the title/action row. */
  bottomBorder?: boolean
}

export function PageLayout({ title, action, children, titleClassName, inlineAction, before, stickyHeader, bottomBorder }: PageLayoutProps) {
  // The page header lives in its own wrapper so the sticky styling can be
  // applied just to it without affecting the rest of the layout.
  const headerBlock = (
    <>
      {before && (
        <div className="mx-auto mb-2 max-w-7xl px-4 sm:px-6 lg:px-8">{before}</div>
      )}
      <PageHeader title={title} action={action} titleClassName={titleClassName} inlineAction={inlineAction} bottomBorder={bottomBorder} />
    </>
  )

  if (stickyHeader) {
    // Kiosk-style viewport-locked layout (all screens). Page header is
    // flex-shrink-0 above the content. Pages opt their tabs / chips into
    // flex-shrink-0 too and put the actual scrolling list as a flex-1 +
    // overflow-y-auto child — pinned elements never move.
    return (
      <div className="flex min-h-0 flex-1 flex-col pt-5">
        <div className="flex-shrink-0 pb-2">{headerBlock}</div>
        <main className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-4 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    )
  }

  // Non-sticky pages: AppShell is a fixed-height (100dvh) flex
  // container with overflow-hidden, so a non-scrollable child would
  // get its tail clipped on phones (the user reported the dashboard
  // distribution cards' bottom edge / pagination dots being cut off
  // on iPhone 17 Pro Max). Make the wrapper a flex column with its
  // own overflow-y-auto so the content scrolls inside the AppShell
  // frame instead of running off-screen.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-5 pb-[max(env(safe-area-inset-bottom),20px)]">
      {headerBlock}
      <main>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  )
}
