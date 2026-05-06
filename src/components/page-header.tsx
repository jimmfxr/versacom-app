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
  /**
   * Adds a thin gray divider directly under the header row. Used on the
   * Dashboard / Tasks / My Equipment pages where the header acts as a
   * separator between the project switcher and the page content below.
   * The divider is drawn INSIDE the page's horizontal padding so it
   * lines up exactly with the content cards (which also live inside
   * that padding) — not the wider container outer edge.
   */
  readonly bottomBorder?: boolean
}

const DEFAULT_TITLE_CLASS = 'text-3xl font-bold tracking-tight text-white'

export function PageHeader({
  title,
  action,
  titleClassName = DEFAULT_TITLE_CLASS,
  inlineAction = false,
  bottomBorder = false,
}: PageHeaderProps) {
  // Outer wrapper: max-w-7xl + horizontal page padding. Same as the
  // page content's outer container, so the inner edge here aligns
  // exactly with the inner edge of any card grid below.
  const outerClass = 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8'
  // Inner row: title + action layout. The border lives HERE (inside
  // the padding) so the divider sits at the same horizontal extent
  // as the content cards on the page, not the wider outer edge.
  const innerBase = inlineAction
    ? 'flex items-center justify-between gap-3 sm:gap-4'
    : 'flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4'
  // Border behaviour with bottomBorder=true:
  //  • inlineAction (single-row layouts like Tasks / Projects):
  //    border at the bottom of the row at every breakpoint.
  //  • Stacked layouts (Dashboard / My Equipment / etc.):
  //    on desktop title + action are side-by-side, so the border is
  //    drawn at the bottom of the row (same as inlineAction). On
  //    mobile they stack and the user wants the line UNDER THE TITLE
  //    — not below the whole stack — so we suppress the row-bottom
  //    border on mobile and render an inline divider as a flex child
  //    between the title and the action.
  const innerClass = bottomBorder
    ? inlineAction
      ? `${innerBase} border-b border-white/20 pb-4`
      : `${innerBase} sm:border-b sm:border-white/20 sm:pb-4`
    : innerBase
  // Mobile-only divider: always render under the title when
  // bottomBorder is on and the layout stacks (non-inlineAction). We
  // intentionally don't gate on `!!action` — pages where the action
  // is sometimes null (e.g. Tasks when the user has a single
  // project) would otherwise lose the divider on mobile.
  const showMobileDivider = bottomBorder && !inlineAction

  return (
    <header>
      <div className={outerClass}>
        <div className={innerClass}>
          <h1 className={titleClassName}>{title}</h1>
          {showMobileDivider && (
            // Mobile-only inline divider — sits between page title
            // and action so the border reads as "under the page
            // name". Hidden on sm+ where the layout collapses to a
            // single row and the row-bottom border kicks in.
            <div className="w-full border-b border-white/20 sm:hidden" />
          )}
          {action}
        </div>
      </div>
    </header>
  )
}
