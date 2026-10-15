import { useState } from 'react'
import {
  AGENT_COMMIT_LABELS,
  reasoningLevelsFor,
  type AgentId,
  type AgentInfo,
  type Procedure,
  type Task
} from '@shared/types'
import DependencyPicker from './DependencyPicker'
import DropZone from './DropZone'
import MarkdownEditor from './MarkdownEditor'
import ModelPicker from './ModelPicker'
import ProcedurePicker from './ProcedurePicker'
import ReasoningSlider from './ReasoningSlider'
import Switch from './Switch'

interface TaskValues {
  title: string
  prompt: string
  agent: AgentId
  model: string | null
  reasoningEffort: string | null
  commit: boolean
  procedures: string[]
  dependencies: string[]
  blockedBy: string[]
  /** Files to copy into the task resources once created (only when withResources). */
  resourcePaths: string[]
}

interface Props {
  agents: AgentInfo[]
  procedures: Procedure[]
  /** Tasks of the project: Done ones can be linked as dependencies, any non-cancelled one as blocker. */
  projectTasks: Task[]
  initial?: Pick<
    Task,
    | 'title'
    | 'prompt'
    | 'agent'
    | 'model'
    | 'reasoningEffort'
    | 'commit'
    | 'procedures'
    | 'dependencies'
    | 'blockedBy'
  >
  /** Code of the task being edited, to preview the commit message (new tasks have none yet). */
  code?: string
  /** Commits are only possible in git projects. */
  gitRepo: boolean
  submitLabel: string
  /** Show a drop zone to attach resource files (new tasks; existing ones use the Files tab). */
  withResources?: boolean
  onSubmit: (values: TaskValues) => Promise<void>
  onCancel: () => void
}

export default function TaskForm({
  agents,
  procedures,
  projectTasks,
  initial,
  submitLabel,
  withResources,
  code,
  gitRepo,
  onSubmit,
  onCancel
}: Props) {
  const defaultAgent = agents.find((a) => a.installed)?.id ?? 'claude'
  const [title, setTitle] = useState(initial?.title ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [agent, setAgent] = useState<AgentId>(initial?.agent ?? defaultAgent)
  const [model, setModel] = useState<string | null>(initial?.model ?? null)
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(initial?.reasoningEffort ?? null)
  const [commit, setCommit] = useState(initial?.commit ?? true)
  const [attached, setAttached] = useState<string[]>(initial?.procedures ?? [])
  const [dependencies, setDependencies] = useState<string[]>(initial?.dependencies ?? [])
  const [blockedBy, setBlockedBy] = useState<string[]>(initial?.blockedBy ?? [])
  const [resourcePaths, setResourcePaths] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const selectedAgent = agents.find((a) => a.id === agent)

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
        reasoningEffort: agent === 'codex' ? reasoningEffort : null,
        commit: gitRepo && commit,
        procedures: attached,
        dependencies,
        blockedBy,
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
            setReasoningEffort(null)
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
          agent={selectedAgent}
          value={model}
          onChange={(next) => {
            setModel(next)
            // Keep the effort only if the new model supports it.
            const levels = reasoningLevelsFor(selectedAgent, next)
            if (!levels.some((l) => l.effort === reasoningEffort)) setReasoningEffort(null)
          }}
        />
      </div>

      {agent === 'codex' && (
        <ReasoningSlider
          agent={selectedAgent}
          model={model}
          value={reasoningEffort}
          onChange={setReasoningEffort}
        />
      )}

      <div className="field">
        <Switch
          checked={gitRepo && commit}
          disabled={!gitRepo}
          onChange={setCommit}
          label="Hacer commit de los cambios"
        />
        <span className="muted small">
          {!gitRepo
            ? 'El proyecto no es un repositorio git: el agente no hará commit.'
            : commit
              ? <>
                  El agente hará commit al terminar con el mensaje{' '}
                  <code>
                    {AGENT_COMMIT_LABELS[agent]}: {code ?? '<código de la tarea>'}
                  </code>
                </>
              : 'El agente dejará los cambios sin commitear.'}
        </span>
      </div>

      <MarkdownEditor value={prompt} onChange={setPrompt} placeholder="Describe la tarea en Markdown…" />

      <div className="field">
        <span className="field-label">Procedimientos</span>
        <ProcedurePicker procedures={procedures} value={attached} onChange={setAttached} />
      </div>

      <div className="field">
        <span className="field-label">Tareas previas</span>
        <DependencyPicker
          tasks={projectTasks.filter((t) => t.status === 'Done' && t.code !== code)}
          value={dependencies}
          onChange={setDependencies}
          emptyLabel="Ninguna tarea vinculada."
          addLabel="+ Añadir tarea terminada…"
        />
        <span className="muted small">
          El agente recibirá su prompt, resumen, commit y outputs como contexto.
        </span>
      </div>

      <div className="field">
        <span className="field-label">Bloqueada por</span>
        <DependencyPicker
          tasks={projectTasks.filter((t) => t.status !== 'Cancelled' && t.code !== code)}
          value={blockedBy}
          onChange={setBlockedBy}
          emptyLabel="No espera a ninguna tarea."
          addLabel="+ Añadir tarea bloqueante…"
          showStatus
        />
        <span className="muted small">
          Al encolarla quedará Bloqueada hasta que todas estas tareas estén Hechas; entonces pasará a
          Pendiente sola.
        </span>
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
