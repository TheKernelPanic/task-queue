import { useEffect, useMemo, useState } from 'react'
import type { AgentInfo, Project, Task } from '@shared/types'
import ProjectForm from './components/ProjectForm'
import StatusBadge from './components/StatusBadge'
import TaskDetail from './components/TaskDetail'
import TaskForm from './components/TaskForm'

type View =
  | { kind: 'empty' }
  | { kind: 'new' }
  | { kind: 'newProject' }
  | { kind: 'task'; code: string }

export default function App() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<number | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [view, setView] = useState<View>({ kind: 'empty' })

  useEffect(() => {
    void window.api.listAgents().then(setAgents)
    void window.api.listProjects().then((list) => {
      setProjects(list)
      if (list.length > 0) setProjectId(list[0].id)
    })
    void window.api.listTasks().then(setTasks)

    return window.api.onTaskChanged((task) =>
      setTasks((prev) => {
        const i = prev.findIndex((t) => t.code === task.code)
        if (i === -1) return [task, ...prev]
        const next = [...prev]
        next[i] = task
        return next
      })
    )
  }, [])

  const project = projects.find((p) => p.id === projectId) ?? null
  const projectTasks = useMemo(() => tasks.filter((t) => t.projectId === projectId), [tasks, projectId])
  const selected = view.kind === 'task' ? tasks.find((t) => t.code === view.code) : undefined

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>TaskQueue</h1>
        <section>
          <div className="section-title">
            Proyectos
            <button className="icon" title="Añadir proyecto" onClick={() => setView({ kind: 'newProject' })}>
              +
            </button>
          </div>
          <ul className="project-list">
            {projects.map((p) => (
              <li
                key={p.id}
                className={p.id === projectId ? 'selected' : ''}
                title={p.path}
                onClick={() => {
                  setProjectId(p.id)
                  setView({ kind: 'empty' })
                }}
              >
                {p.name}
                {!p.isGitRepo && <span className="muted"> (sin git)</span>}
              </li>
            ))}
          </ul>
        </section>
        <section className="agents">
          <div className="section-title">Agentes</div>
          {agents.map((a) => (
            <div key={a.id} className={a.installed ? '' : 'muted'} title={a.path ?? ''}>
              {a.installed ? '●' : '○'} {a.name}
            </div>
          ))}
        </section>
      </aside>

      <main className="task-list-pane">
        {project ? (
          <>
            <div className="pane-header">
              <div>
                <h2>{project.name}</h2>
                <div className="muted small">{project.path}</div>
              </div>
              <button className="primary" onClick={() => setView({ kind: 'new' })}>
                Nueva tarea
              </button>
            </div>
            <table className="task-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Título</th>
                  <th>Agente</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {projectTasks.map((t) => (
                  <tr
                    key={t.code}
                    className={view.kind === 'task' && view.code === t.code ? 'selected' : ''}
                    onClick={() => setView({ kind: 'task', code: t.code })}
                  >
                    <td>
                      <code>{t.code}</code>
                    </td>
                    <td>{t.title}</td>
                    <td>{t.agent}</td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {projectTasks.length === 0 && <p className="muted">No hay tareas en este proyecto.</p>}
          </>
        ) : (
          <p className="muted">Añade un proyecto para empezar.</p>
        )}
      </main>

      <section className="detail-pane">
        {view.kind === 'newProject' && (
          <>
            <h2>Nuevo proyecto</h2>
            <ProjectForm
              onCancel={() => setView({ kind: 'empty' })}
              onCreated={(created) => {
                setProjects((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
                setProjectId(created.id)
                setView({ kind: 'empty' })
              }}
            />
          </>
        )}
        {view.kind === 'new' && project && (
          <>
            <h2>Nueva tarea</h2>
            <TaskForm
              agents={agents}
              submitLabel="Crear"
              onCancel={() => setView({ kind: 'empty' })}
              onSubmit={async (values) => {
                const task = await window.api.createTask({ ...values, projectId: project.id })
                setView({ kind: 'task', code: task.code })
              }}
            />
          </>
        )}
        {selected && <TaskDetail key={selected.code} task={selected} agents={agents} />}
        {view.kind === 'empty' && <p className="muted">Selecciona una tarea.</p>}
      </section>
    </div>
  )
}
