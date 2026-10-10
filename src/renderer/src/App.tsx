import { useEffect, useMemo, useState } from 'react'
import type { AgentInfo, Procedure, Project, Task } from '@shared/types'
import ProcedureDetail from './components/ProcedureDetail'
import ProcedureForm from './components/ProcedureForm'
import ProjectForm from './components/ProjectForm'
import StatusBadge from './components/StatusBadge'
import TaskDetail from './components/TaskDetail'
import TaskForm from './components/TaskForm'

type View =
  | { kind: 'empty' }
  | { kind: 'new' }
  | { kind: 'newProject' }
  | { kind: 'task'; code: string }
  | { kind: 'newProcedure' }
  | { kind: 'procedure'; code: string }

type Section = 'tasks' | 'procedures'

export default function App() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<number | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [section, setSection] = useState<Section>('tasks')
  const [view, setView] = useState<View>({ kind: 'empty' })

  useEffect(() => {
    void window.api.listAgents().then(setAgents)
    void window.api.listProjects().then((list) => {
      setProjects(list)
      if (list.length > 0) setProjectId(list[0].id)
    })
    void window.api.listTasks().then(setTasks)
    void window.api.listProcedures().then(setProcedures)

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
  const selectedProcedure =
    view.kind === 'procedure' ? procedures.find((p) => p.code === view.code) : undefined

  function upsertProcedure(procedure: Procedure) {
    setProcedures((prev) =>
      [...prev.filter((p) => p.code !== procedure.code), procedure].sort((a, b) =>
        a.code.localeCompare(b.code)
      )
    )
  }

  function openProcedure(code: string) {
    setSection('procedures')
    setView({ kind: 'procedure', code })
  }

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
                className={section === 'tasks' && p.id === projectId ? 'selected' : ''}
                title={p.path}
                onClick={() => {
                  setProjectId(p.id)
                  setSection('tasks')
                  setView({ kind: 'empty' })
                }}
              >
                {p.name}
                {!p.isGitRepo && <span className="muted"> (sin git)</span>}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="section-title">Biblioteca</div>
          <ul className="project-list">
            <li
              className={section === 'procedures' ? 'selected' : ''}
              onClick={() => {
                setSection('procedures')
                setView({ kind: 'empty' })
              }}
            >
              Procedimientos <span className="muted">({procedures.length})</span>
            </li>
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
        {section === 'procedures' ? (
          <>
            <div className="pane-header">
              <h2>Procedimientos</h2>
              <button className="primary" onClick={() => setView({ kind: 'newProcedure' })}>
                Nuevo procedimiento
              </button>
            </div>
            <table className="task-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Título</th>
                </tr>
              </thead>
              <tbody>
                {procedures.map((p) => (
                  <tr
                    key={p.code}
                    className={view.kind === 'procedure' && view.code === p.code ? 'selected' : ''}
                    onClick={() => setView({ kind: 'procedure', code: p.code })}
                  >
                    <td>
                      <code>{p.code}</code>
                    </td>
                    <td>{p.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {procedures.length === 0 && <p className="muted">No hay procedimientos.</p>}
          </>
        ) : project ? (
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
              procedures={procedures}
              submitLabel="Crear"
              onCancel={() => setView({ kind: 'empty' })}
              onSubmit={async (values) => {
                const task = await window.api.createTask({ ...values, projectId: project.id })
                setView({ kind: 'task', code: task.code })
              }}
            />
          </>
        )}
        {selected && (
          <TaskDetail
            key={selected.code}
            task={selected}
            agents={agents}
            procedures={procedures}
            onOpenProcedure={openProcedure}
          />
        )}
        {view.kind === 'newProcedure' && (
          <>
            <h2>Nuevo procedimiento</h2>
            <ProcedureForm
              submitLabel="Crear"
              onCancel={() => setView({ kind: 'empty' })}
              onSubmit={async (values) => {
                const created = await window.api.createProcedure(values)
                upsertProcedure(created)
                setView({ kind: 'procedure', code: created.code })
              }}
            />
          </>
        )}
        {selectedProcedure && (
          <ProcedureDetail
            key={selectedProcedure.code}
            procedure={selectedProcedure}
            onUpdated={upsertProcedure}
            onDeleted={(code) => {
              setProcedures((prev) => prev.filter((p) => p.code !== code))
              setView({ kind: 'empty' })
            }}
          />
        )}
        {view.kind === 'empty' && (
          <p className="muted">
            {section === 'procedures' ? 'Selecciona un procedimiento.' : 'Selecciona una tarea.'}
          </p>
        )}
      </section>
    </div>
  )
}
