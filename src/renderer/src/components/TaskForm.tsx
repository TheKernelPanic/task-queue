import { useRef, useState } from 'react'
import type { AgentId, AgentInfo, Task } from '@shared/types'
import Markdown from './Markdown'

interface Props {
  agents: AgentInfo[]
  initial?: Pick<Task, 'title' | 'prompt' | 'agent'>
  submitLabel: string
  onSubmit: (values: { title: string; prompt: string; agent: AgentId }) => Promise<void>
  onCancel: () => void
}

export default function TaskForm({ agents, initial, submitLabel, onSubmit, onCancel }: Props) {
  const defaultAgent = agents.find((a) => a.installed)?.id ?? 'claude'
  const [title, setTitle] = useState(initial?.title ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [agent, setAgent] = useState<AgentId>(initial?.agent ?? defaultAgent)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  async function insertPath(kind: 'file' | 'directory') {
    const path = await window.api.pickPath(kind)
    if (!path) return
    const el = textarea.current
    const start = el?.selectionStart ?? prompt.length
    const end = el?.selectionEnd ?? prompt.length
    const snippet = `\`${path}\``
    setPrompt(prompt.slice(0, start) + snippet + prompt.slice(end))
    setPreview(false)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + snippet.length, start + snippet.length)
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !prompt.trim()) {
      setError('El título y el prompt son obligatorios')
      return
    }
    try {
      await onSubmit({ title: title.trim(), prompt, agent })
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

      <div className="prompt-editor">
        <div className="toolbar">
          <button type="button" className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>
            Escribir
          </button>
          <button type="button" className={preview ? 'active' : ''} onClick={() => setPreview(true)}>
            Vista previa
          </button>
          <span className="spacer" />
          <button type="button" onClick={() => insertPath('file')}>
            + Fichero
          </button>
          <button type="button" onClick={() => insertPath('directory')}>
            + Carpeta
          </button>
        </div>
        {preview ? (
          <div className="preview">
            <Markdown>{prompt || '_Sin contenido_'}</Markdown>
          </div>
        ) : (
          <textarea
            ref={textarea}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe la tarea en Markdown…"
          />
        )}
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
