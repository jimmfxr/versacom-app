type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'danger'
}

export function IconButton({ variant = 'default', children, className = '', ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      // Same chip-inactive chrome as the Edit / Cancel / Returned
      // buttons across the app — thin white/10 border, transparent
      // fill, gray-200 icon, hover bumps to white-20 border + faint
      // bg, active flips to cyan. Keeps card close-X consistent
      // with the surrounding action row buttons.
      className={`rounded-lg border border-white/10 p-1.5 text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:opacity-50 ${
        variant === 'danger' ? 'hover:text-red-400' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
