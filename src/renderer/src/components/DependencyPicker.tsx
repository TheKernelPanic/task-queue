import type { Task } from '@shared/types'

interface Props {
  /** Tasks that can be linked: the Done tasks of the project. */
  tasks: Task[]
  value: string[]
  onChange: (codes: string[]) => void
}

/** Previously completed tasks a task builds on; the agent gets them as context. */
export default function DependencyPicker({ tasks, value, onChange }: Props) {
  const byCode = new Map(tasks.map((t) => [t.code, t]))
  const available = tasks.filter((t) => !value.includes(t.code))

  return (
    <div className="procedure-picker">
      {value.length === 0 && <div className="muted small">Ninguna tarea vinculada.</div>}
      <ol>
        {value.map((code) => (
          <li key={code}>
            <code>{code}</code> {byCode.get(code)?.title ?? <span className="muted">(no disponible)</span>}
            <span className="spacer" />
            <button type="button" className="icon danger" onClick={() => onChange(value.filter((c) => c !== code))}>
              ×
            </button>
          </li>
        ))}
      </ol>
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...value, e.target.value])
          }}
        >
          <option value="">+ Añadir tarea terminada…</option>
          {available.map((t) => (
            <option key={t.code} value={t.code}>
              {t.code} · {t.title}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
