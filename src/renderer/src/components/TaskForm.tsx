import { useState } from 'react'
import type { AgentId, AgentInfo, Procedure, Task } from '@shared/types'
import DropZone from './DropZone'
import MarkdownEditor from './MarkdownEditor'
import ModelPicker from './ModelPicker'
import ProcedurePicker from './ProcedurePicker'

interface TaskValues {
  title: string
  prompt: string
  agent: AgentId
  model: string | null
  procedures: string[]
  /** Files to copy into the task resources once created (only when withResources). */
  resourcePaths: string[]
}

interface Props {
  agents: AgentInfo[]
  procedures: Procedure[]
  initial?: Pick<Task, 'title' | 'prompt' | 'agent' | 'model' | 'procedures'>
  submitLabel: string
  /** Show a drop zone to attach resource files (new tasks; existing ones use the Files tab). */
  withResources?: boolean
  onSubmit: (values: TaskValues) => Promise<void>
  onCancel: () => void
}

export default function TaskForm({
  agents,
  procedures,
  initial,
  submitLabel,
  withResources,
  onSubmit,
  onCancel
}: Props) {
  const defaultAgent = agents.find((a) => a.installed)?.id ?? 'claude'
  const [title, setTitle] = useState(initial?.title ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [agent, setAgent] = useState<AgentId>(initial?.agent ?? defaultAgent)
  const [model, setModel] = useState<string | null>(initial?.model ?? null)
  const [attached, setAttached] = useState<string[]>(initial?.procedures ?? [])
  const [resourcePaths, setResourcePaths] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !prompt.trim()) {
      setError('El título y el prompt son obligatorios')
      return
    }
    try {
      await onSubmit({
        title: title.trim(),
        prompt,
        agent,
        model: model?.trim() || null,
        procedures: attached,
        resourcePaths
      })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form className="task-form" onSubmit={submit}>
      <label>
        Título
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>

      <label>
        Agente
        <select
          value={agent}
          onChange={(e) => {
            setAgent(e.target.value as AgentId)
            setModel(null)
          }}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id} disabled={!a.installed}>
              {a.name}
              {a.installed ? '' : ' (no instalado)'}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span className="field-label">Modelo</span>
        <ModelPicker
          key={agent}
          agent={agents.find((a) => a.id === agent)}
          value={model}
          onChange={setModel}
        />
      </div>

      <MarkdownEditor value={prompt} onChange={setPrompt} placeholder="Describe la tarea en Markdown…" />

      <div className="field">
        <span className="field-label">Procedimientos</span>
        <ProcedurePicker procedures={procedures} value={attached} onChange={setAttached} />
      </div>

      {withResources && (
        <div className="field">
          <span className="field-label">Recursos</span>
          <DropZone
            onPaths={(paths) => setResourcePaths((prev) => [...new Set([...prev, ...paths])])}
          />
          {resourcePaths.length > 0 && (
            <ul className="file-list">
              {resourcePaths.map((p) => (
                <li key={p}>
                  <span title={p}>{p.split(/[\\/]/).pop()}</span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="icon danger"
                    onClick={() => setResourcePaths((prev) => prev.filter((x) => x !== p))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <div className="actions">
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="primary">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
