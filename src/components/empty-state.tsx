type EmptyStateProps = {
  icon: React.ReactNode
  title: string
  message: string
}

export function EmptyState({ icon, title, message }: EmptyStateProps) {
  return (
    <div className="p-12 text-center">
      <div className="mx-auto size-12 text-gray-500">{icon}</div>
      <p className="mt-4 text-base font-medium text-white">{title}</p>
      <p className="mt-1 text-sm text-gray-400">{message}</p>
    </div>
  )
}
