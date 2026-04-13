type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'danger'
}

export function IconButton({ variant = 'default', children, className = '', ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/10 ${
        variant === 'danger' ? 'hover:text-red-400' : 'hover:text-white'
      } disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
