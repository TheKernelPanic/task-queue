import { reasoningLevelsFor, type AgentInfo } from '@shared/types'

interface Props {
  agent: AgentInfo | undefined
  /** Model chosen for the task; null = the agent's default model. */
  model: string | null
  /** null = the agent's default effort. */
  value: string | null
  onChange: (effort: string | null) => void
}

/** Slider to choose how hard the model reasons, from "default" to the deepest supported level. */
export default function ReasoningSlider({ agent, model, value, onChange }: Props) {
  const levels = reasoningLevelsFor(agent, model)
  if (levels.length === 0) return null

  const option = agent?.models.find((m) => m.id === (model ?? agent?.defaultModel))
  // config.toml's effort applies to any model; otherwise each model has its own default.
  const fallback = agent?.defaultReasoning ?? option?.defaultReasoning
  const index = value === null ? 0 : levels.findIndex((l) => l.effort === value) + 1
  const current = index > 0 ? levels[index - 1] : null

  return (
    <div className="field reasoning-slider">
      <span className="field-label">
        Esfuerzo de razonamiento: <strong>{current?.effort ?? 'por defecto'}</strong>
      </span>
      <input
        type="range"
        aria-label="Esfuerzo de razonamiento"
        min={0}
        max={levels.length}
        step={1}
        value={index}
        onChange={(e) => {
          const i = Number(e.target.value)
          onChange(i === 0 ? null : levels[i - 1].effort)
        }}
      />
      <div className="reasoning-ticks" aria-hidden>
        {['defecto', ...levels.map((l) => l.effort)].map((label, i) => (
          <span key={label} className={i === index ? 'active' : undefined}>
            {label}
          </span>
        ))}
      </div>
      <span className="muted small">
        {current
          ? current.description || `Codex razonará con esfuerzo ${current.effort}.`
          : fallback
            ? `Se usará el esfuerzo por defecto de Codex (${fallback}).`
            : 'Se usará el esfuerzo por defecto de Codex.'}
      </span>
    </div>
  )
}
