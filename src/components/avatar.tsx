type AvatarProps = {
  name: string
  size?: 'sm' | 'md'
}

const sizes = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
}

export function Avatar({ name, size = 'sm' }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-[#0178a3] font-medium text-white ${sizes[size]}`}>
      {initials}
    </span>
  )
}
