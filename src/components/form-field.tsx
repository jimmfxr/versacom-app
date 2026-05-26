// compact = true is no longer visually smaller than the default — it
// just uses a slightly tighter label-row (smaller label text, less
// top margin) so packed grids still feel dense without making the
// actual input smaller than the action buttons in the same form.
// The input itself matches the standard 'px-3 py-2 text-base' size
// used elsewhere in the app for consistency with the bumped buttons.
const labelStyles = {
  false: 'block text-xs font-medium text-gray-400',
  true: 'block text-[10px] font-medium text-gray-500',
}

const fieldStyles = {
  false:
    'mt-1 w-full rounded-lg border-2 border-white/10 bg-[#202020] px-3 py-2 text-base text-white outline-none transition-colors focus:border-[#0178a3]',
  true:
    'mt-0.5 w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-base text-white outline-none focus:border-[#0178a3]',
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
