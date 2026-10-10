import { useState } from 'react'
import {
  MANUAL_TRANSITIONS,
  type AgentInfo,
  type Procedure,
  type Task,
  type TaskStatus
} from '@shared/types'
import CommitView from './CommitView'
import HistoryView from './HistoryView'
import Markdown from './Markdown'
import StatusBadge from './StatusBadge'
import TaskForm from './TaskForm'

type Tab = 'prompt' | 'summary' | 'history' | 'commit'

const ACTION_LABELS: Record<TaskStatus, string> = {
  Created: 'Volver a Creada',
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
  onOpenProcedure: (code: string) => void
}

export default function TaskDetail({ task, agents, procedures, onOpenProcedure }: Props) {
  const [tab, setTab] = useState<Tab>('prompt')
  const [editing, setEditing] = useState(false)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)

  const editable = task.status === 'Created' || task.status === 'Stopped'
  const agentName = agents.find((a) => a.id === task.agent)?.name ?? task.agent
  const procedureTitles = new Map(procedures.map((p) => [p.code, p.title]))

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
        </div>
        {error && <div className="error">{error}</div>}
      </header>

      {task.status === 'WaitingForInput' && task.question && (
        <div className="question">
          <strong>El agente pregunta:</strong>
          <Markdown>{task.question}</Markdown>
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Tu respuesta…" />
          <button
            className="primary"
            disabled={!answer.trim()}
            onClick={() =>
              run(async () => {
                await window.api.answerQuestion(task.code, answer.trim())
                setAnswer('')
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
          procedures={procedures}
          initial={task}
          submitLabel="Guardar"
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
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
                ['summary', 'Resumen'],
                ['history', 'History'],
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
                      {task.procedures.map((code) => (
                        <li key={code}>
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault()
                              onOpenProcedure(code)
                            }}
                          >
                            <code>{code}</code> {procedureTitles.get(code)}
                          </a>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </>
            )}
            {tab === 'summary' &&
              (task.summary ? <Markdown>{task.summary}</Markdown> : <p className="muted">Sin resumen todavía.</p>)}
            {tab === 'history' && <HistoryView code={task.code} />}
            {tab === 'commit' && <CommitView key={task.commitHash ?? 'none'} code={task.code} />}
          </div>
        </>
      )}
    </div>
  )
}
