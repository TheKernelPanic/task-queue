import { useState } from 'react'
import type { AgentInfo } from '@shared/types'

const CUSTOM = '__custom__'

interface Props {
  agent: AgentInfo | undefined
  /** null = the agent's default model. */
  value: string | null
  onChange: (model: string | null) => void
}

/** Model dropdown for the selected agent, with an "Otro…" option to type any model name. */
export default function ModelPicker({ agent, value, onChange }: Props) {
  const models = agent?.models ?? []
  const known = value === null || models.some((m) => m.id === value)
  const [custom, setCustom] = useState(!known)

  return (
    <div className="row">
      <select
        value={custom ? CUSTOM : (value ?? '')}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true)
            onChange(null)
          } else {
            setCustom(false)
            onChange(e.target.value || null)
          }
        }}
      >
        <option value="">Por defecto del agente</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value={CUSTOM}>Otro…</option>
      </select>
      {custom && (
        <input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="Nombre del modelo"
          autoFocus
        />
      )}
    </div>
  )
}
