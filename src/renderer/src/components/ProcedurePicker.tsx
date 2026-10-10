import type { Procedure } from '@shared/types'

interface Props {
  procedures: Procedure[]
  value: string[]
  onChange: (codes: string[]) => void
}

/** Ordered list of procedures attached to a task. */
export default function ProcedurePicker({ procedures, value, onChange }: Props) {
  const byCode = new Map(procedures.map((p) => [p.code, p]))
  const available = procedures.filter((p) => !value.includes(p.code))

  function move(index: number, delta: number) {
    const next = [...value]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    onChange(next)
  }

  return (
    <div className="procedure-picker">
      {value.length === 0 && <div className="muted small">Ningún procedimiento vinculado.</div>}
      <ol>
        {value.map((code, i) => (
          <li key={code}>
            <code>{code}</code> {byCode.get(code)?.title ?? <span className="muted">(no existe)</span>}
            <span className="spacer" />
            <button type="button" className="icon" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" className="icon" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
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
          <option value="">+ Añadir procedimiento…</option>
          {available.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} · {p.title}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
