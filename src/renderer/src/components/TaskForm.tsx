import { useState } from 'react'
import type { AgentId, AgentInfo, Procedure, Task } from '@shared/types'
import MarkdownEditor from './MarkdownEditor'
import ProcedurePicker from './ProcedurePicker'

interface TaskValues {
  title: string
  prompt: string
  agent: AgentId
  procedures: string[]
}

interface Props {
  agents: AgentInfo[]
  procedures: Procedure[]
  initial?: Pick<Task, 'title' | 'prompt' | 'agent' | 'procedures'>
  submitLabel: string
  onSubmit: (values: TaskValues) => Promise<void>
  onCancel: () => void
}

export default function TaskForm({ agents, procedures, initial, submitLabel, onSubmit, onCancel }: Props) {
  const defaultAgent = agents.find((a) => a.installed)?.id ?? 'claude'
  const [title, setTitle] = useState(initial?.title ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [agent, setAgent] = useState<AgentId>(initial?.agent ?? defaultAgent)
  const [attached, setAttached] = useState<string[]>(initial?.procedures ?? [])
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !prompt.trim()) {
      setError('El título y el prompt son obligatorios')
      return
    }
    try {
      await onSubmit({ title: title.trim(), prompt, agent, procedures: attached })
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
        <select value={agent} onChange={(e) => setAgent(e.target.value as AgentId)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id} disabled={!a.installed}>
              {a.name}
              {a.installed ? '' : ' (no instalado)'}
            </option>
          ))}
        </select>
      </label>

      <MarkdownEditor value={prompt} onChange={setPrompt} placeholder="Describe la tarea en Markdown…" />

      <div className="field">
        <span className="field-label">Procedimientos</span>
        <ProcedurePicker procedures={procedures} value={attached} onChange={setAttached} />
      </div>

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
