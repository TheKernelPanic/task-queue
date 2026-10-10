import { useState } from 'react'
import type { Procedure, ProcedureInput } from '@shared/types'
import MarkdownEditor from './MarkdownEditor'

interface Props {
  initial?: Pick<Procedure, 'title' | 'prompt'>
  submitLabel: string
  onSubmit: (values: ProcedureInput) => Promise<void>
  onCancel: () => void
}

export default function ProcedureForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !prompt.trim()) {
      setError('El título y el prompt son obligatorios')
      return
    }
    try {
      await onSubmit({ title: title.trim(), prompt })
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
