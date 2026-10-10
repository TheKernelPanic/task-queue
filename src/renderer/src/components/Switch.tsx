interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
}

export default function Switch({ checked, onChange, disabled, label }: Props) {
  return (
    <label className={`switch${disabled ? ' disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
      {label}
    </label>
  )
}
