import { useState } from 'react'
import type { Procedure, ProcedureInput, Project } from '@shared/types'
import MarkdownEditor from './MarkdownEditor'

interface Props {
  projects: Project[]
  initial?: Pick<Procedure, 'title' | 'prompt' | 'projectIds'>
  submitLabel: string
  onSubmit: (values: ProcedureInput) => Promise<void>
  onCancel: () => void
}

export default function ProcedureForm({ projects, initial, submitLabel, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [projectIds, setProjectIds] = useState<number[]>(initial?.projectIds ?? [])
  const [error, setError] = useState<string | null>(null)

  function toggleProject(id: number) {
    setProjectIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !prompt.trim()) {
      setError('El título y el prompt son obligatorios')
      return
    }
    if (projectIds.length === 0) {
      setError('Selecciona al menos un proyecto')
      return
    }
    try {
      await onSubmit({ title: title.trim(), prompt, projectIds })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form className="task-form" onSubmit={submit}>
      <label>
        Título
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus />
      </label>

      <div className="field">
        <span className="field-label">Proyectos</span>
        <div className="project-checks">
          {projects.map((p) => (
            <label key={p.id} className="chip">
              <input
                type="checkbox"
                checked={projectIds.includes(p.id)}
                onChange={() => toggleProject(p.id)}
              />
              {p.name}
            </label>
          ))}
          {projects.length === 0 && <span className="muted small">No hay proyectos dados de alta.</span>}
        </div>
      </div>

      <MarkdownEditor
        value={prompt}
        onChange={setPrompt}
        placeholder="Instrucciones del procedimiento en Markdown…"
      />

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
