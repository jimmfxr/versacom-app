export type PageHeaderProps = {
  readonly title: string
}

export function PageHeader({ title }: PageHeaderProps) {
  return (
    <header>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
      </div>
    </header>
  )
}
