import { useState } from 'react'
import {
  commitMessage,
  isTaskDeletable,
  isTaskEditable,
  MANUAL_TRANSITIONS,
  type AgentInfo,
  type Procedure,
  type Task,
  type TaskStatus
} from '@shared/types'
import CommitView from './CommitView'
import DropZone from './DropZone'
import FilesView from './FilesView'
import HistoryView from './HistoryView'
import Markdown from './Markdown'
import StatusBadge from './StatusBadge'
import TaskForm from './TaskForm'
import UsageView from './UsageView'
import WorkspaceView from './WorkspaceView'

type Tab = 'prompt' | 'files' | 'workspace' | 'summary' | 'history' | 'usage' | 'commit'

/** Last selected tab, kept when switching to another task (the component remounts per task). */
let lastTab: Tab = 'prompt'

const ACTION_LABELS: Record<TaskStatus, string> = {
  Created: 'Creada',
  Pending: 'Encolar',
  InProgress: 'En curso',
  WaitingForInput: 'Esperando',
  Stopped: 'Detener',
  Done: 'Hecha',
  Cancelled: 'Cancelar'
}

interface Props {
  task: Task
  agents: AgentInfo[]
  procedures: Procedure[]
  gitRepo: boolean
  onOpenProcedure: (code: string) => void
}

export default function TaskDetail({ task, agents, procedures, gitRepo, onOpenProcedure }: Props) {
  const [tab, setTabState] = useState<Tab>(lastTab)
  const [editing, setEditing] = useState(false)
  const [answer, setAnswer] = useState('')
  const [answerPaths, setAnswerPaths] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const editable = isTaskEditable(task)
  const agentName = agents.find((a) => a.id === task.agent)?.name ?? task.agent
  const currentProcedures = new Map(procedures.map((p) => [p.code, p]))

  function setTab(next: Tab) {
    lastTab = next
    setTabState(next)
  }

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <div className="task-detail">
      <header>
        <div className="title-row">
          <code>{task.code}</code>
          <h2>{task.title}</h2>
          <StatusBadge status={task.status} />
        </div>
        <div className="meta">
          Agente: {agentName}
          {' · '}Modelo: {task.model ? <code>{task.model}</code> : 'por defecto'}
          {' · '}Commit:{' '}
          {task.commit && gitRepo ? <code>{commitMessage(task)}</code> : 'no'}
          {task.sessionId && <> · Sesión: <code>{task.sessionId.slice(0, 8)}</code></>}
          {task.commitHash && <> · Commit: <code>{task.commitHash.slice(0, 8)}</code></>}
        </div>
        <div className="actions">
          {MANUAL_TRANSITIONS[task.status].map((s) => (
            <button
              key={s}
              className={s === 'Pending' ? 'primary' : s === 'Cancelled' ? 'danger' : ''}
              onClick={() => run(() => window.api.setTaskStatus(task.code, s))}
            >
              {ACTION_LABELS[s]}
            </button>
          ))}
          {editable && !editing && <button onClick={() => setEditing(true)}>Editar</button>}
          {isTaskDeletable(task) && (
            <button
              className="danger"
              onClick={() => {
                const ok = window.confirm(
                  `¿Borrar ${task.code} definitivamente?\n\nSe eliminarán su historial, consumo, recursos, ` +
                    'adjuntos y outputs. Esta acción no se puede deshacer.'
                )
                if (ok) void run(() => window.api.deleteTask(task.code))
              }}
            >
              Borrar
            </button>
          )}
        </div>
        {error && <div className="error">{error}</div>}
      </header>

      {task.status === 'WaitingForInput' && task.question && (
        <div className="question">
          <strong>El agente pregunta:</strong>
          <Markdown>{task.question}</Markdown>
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Tu respuesta…" />
          <DropZone onPaths={(paths) => setAnswerPaths((prev) => [...new Set([...prev, ...paths])])} />
          {answerPaths.length > 0 && (
            <ul className="file-list">
              {answerPaths.map((p) => (
                <li key={p}>
                  <span title={p}>{p.split(/[\\/]/).pop()}</span>
                  <span className="spacer" />
                  <button
                    className="icon danger"
                    onClick={() => setAnswerPaths((prev) => prev.filter((x) => x !== p))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            className="primary"
            disabled={!answer.trim() && answerPaths.length === 0}
            onClick={() =>
              run(async () => {
                await window.api.answerQuestion(task.code, answer.trim(), answerPaths)
                setAnswer('')
                setAnswerPaths([])
              })
            }
          >
            Responder y reanudar
          </button>
        </div>
      )}

      {editing ? (
        <TaskForm
          agents={agents}
          procedures={procedures.filter((p) => p.projectIds.includes(task.projectId))}
          initial={task}
          code={task.code}
          gitRepo={gitRepo}
          submitLabel="Guardar"
          onCancel={() => setEditing(false)}
          onSubmit={async ({ resourcePaths: _, ...values }) => {
            await window.api.updateTask(task.code, values)
            setEditing(false)
          }}
        />
      ) : (
        <>
          <nav className="tabs">
            {(
              [
                ['prompt', 'Prompt'],
                ['files', 'Ficheros'],
                ['workspace', 'Workspace'],
                ['summary', 'Resumen'],
                ['history', 'History'],
                ['usage', 'Consumo'],
                ['commit', 'Commit']
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="tab-content">
            {tab === 'prompt' && (
              <>
                <Markdown>{task.prompt}</Markdown>
                {task.procedures.length > 0 && (
                  <div className="linked-procedures">
                    <div className="field-label">Procedimientos</div>
                    <ol>
                      {task.procedures.map((code) => {
                        const frozen = task.procedureSnapshots.find((p) => p.code === code)
                        const current = currentProcedures.get(code)
                        // SQLite timestamps ('YYYY-MM-DD HH:MM:SS') compare correctly as strings.
                        const changed = frozen && current && current.updatedAt > frozen.snapshotAt
                        return (
                          <li key={code}>
                            <details>
                              <summary>
                                <code>{code}</code> {frozen?.title ?? current?.title}
                                {frozen && <span className="muted small"> · copia del {frozen.snapshotAt}</span>}
                                {changed && <span className="warn small"> · modificado después de encolar</span>}
                              </summary>
                              <Markdown>{frozen?.prompt ?? current?.prompt ?? ''}</Markdown>
                              <a
                                href="#"
                                className="small"
                                onClick={(e) => {
                                  e.preventDefault()
                                  onOpenProcedure(code)
                                }}
                              >
                                Ver procedimiento actual
                              </a>
                            </details>
                          </li>
                        )
                      })}
                    </ol>
                    {task.procedureSnapshots.length > 0 && (
                      <p className="muted small">
                        El agente sigue la copia tomada al encolar la tarea, no la versión actual.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            {tab === 'files' && <FilesView task={task} />}
            {tab === 'workspace' && <WorkspaceView task={task} />}
            {tab === 'summary' &&
              (task.summary ? <Markdown>{task.summary}</Markdown> : <p className="muted">Sin resumen todavía.</p>)}
            {tab === 'history' && <HistoryView code={task.code} />}
            {tab === 'usage' && <UsageView code={task.code} />}
            {tab === 'commit' && <CommitView key={task.commitHash ?? 'none'} code={task.code} />}
          </div>
        </>
      )}
    </div>
  )
}
