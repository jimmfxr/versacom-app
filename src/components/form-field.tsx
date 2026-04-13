const labelStyles = {
  false: 'block text-xs font-medium text-gray-400',
  true: 'block text-[10px] font-medium text-gray-500',
}

const fieldStyles = {
  false:
    'mt-1 w-full rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-base text-white outline-none transition-colors focus:border-[#0178a3]',
  true:
    'mt-0.5 w-full rounded border border-white/10 bg-[#202020] px-2 py-1 text-base text-white outline-none focus:border-[#0178a3]',
}

type FormInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label: string
  compact?: boolean
}

export function FormInput({ label, compact = false, ...props }: FormInputProps) {
  return (
    <div>
      <label className={labelStyles[`${compact}`]}>{label}</label>
      <input {...props} className={fieldStyles[`${compact}`]} />
    </div>
  )
}

type FormSelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
  label: string
  compact?: boolean
  children: React.ReactNode
}

export function FormSelect({ label, compact = false, children, ...props }: FormSelectProps) {
  return (
    <div>
      <label className={labelStyles[`${compact}`]}>{label}</label>
      <select {...props} className={`${fieldStyles[`${compact}`]} appearance-none`}>
        {children}
      </select>
    </div>
  )
}
