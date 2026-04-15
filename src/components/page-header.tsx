export type PageHeaderProps = {
  readonly title: string
  readonly action?: React.ReactNode
}

export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <header>
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
        {action}
      </div>
    </header>
  )
}
