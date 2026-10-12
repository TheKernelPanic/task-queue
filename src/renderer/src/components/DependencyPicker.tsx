import type { Task } from '@shared/types'
import { STATUS_LABELS } from './StatusBadge'

interface Props {
  /** Tasks that can be linked. */
  tasks: Task[]
  value: string[]
  onChange: (codes: string[]) => void
  emptyLabel: string
  addLabel: string
  /** Show each task's status next to its title. */
  showStatus?: boolean
}

/** Tasks of the same project linked to a task (previous work or blocking tasks). */
export default function DependencyPicker({ tasks, value, onChange, emptyLabel, addLabel, showStatus }: Props) {
  const byCode = new Map(tasks.map((t) => [t.code, t]))
  const available = tasks.filter((t) => !value.includes(t.code))
  const label = (t: Task) => (showStatus ? `${t.title} (${STATUS_LABELS[t.status]})` : t.title)

  return (
    <div className="procedure-picker">
      {value.length === 0 && <div className="muted small">{emptyLabel}</div>}
      <ol>
        {value.map((code) => {
          const task = byCode.get(code)
          return (
            <li key={code}>
              <code>{code}</code> {task ? label(task) : <span className="muted">(no disponible)</span>}
              <span className="spacer" />
              <button type="button" className="icon danger" onClick={() => onChange(value.filter((c) => c !== code))}>
                ×
              </button>
            </li>
          )
        })}
      </ol>
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...value, e.target.value])
          }}
        >
          <option value="">{addLabel}</option>
          {available.map((t) => (
            <option key={t.code} value={t.code}>
              {t.code} · {label(t)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
