export type PageHeaderProps = {
  readonly title: string
  readonly action?: React.ReactNode
  /** Optional override for the h1's class. Defaults to text-3xl font-bold. */
  readonly titleClassName?: string
  /**
   * Force title + action onto one row even on mobile (default stacks them).
   * Use when the action is small (e.g. a + icon) and benefits from being
   * inline with the heading.
   */
  readonly inlineAction?: boolean
}

const DEFAULT_TITLE_CLASS = 'text-3xl font-bold tracking-tight text-white'

export function PageHeader({
  title,
  action,
  titleClassName = DEFAULT_TITLE_CLASS,
  inlineAction = false,
}: PageHeaderProps) {
  const containerClass = inlineAction
    ? 'mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8'
    : 'mx-auto flex max-w-7xl flex-col items-start gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 lg:px-8'

  return (
    <header>
      <div className={containerClass}>
        <h1 className={titleClassName}>{title}</h1>
        {action}
      </div>
    </header>
  )
}
