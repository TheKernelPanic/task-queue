import { useEffect, useMemo, useState } from 'react'
import type { AgentInfo, Procedure, Project, Task } from '@shared/types'
import ProcedureDetail from './components/ProcedureDetail'
import ProcedureForm from './components/ProcedureForm'
import ProjectForm from './components/ProjectForm'
import StatusBadge from './components/StatusBadge'
import TaskDetail from './components/TaskDetail'
import TaskForm from './components/TaskForm'
import UpdateFooter from './components/UpdateFooter'
import { playDoneChime } from './sound'

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
  const [procedureFilter, setProcedureFilter] = useState<number | 'all'>('all')
  const [view, setView] = useState<View>({ kind: 'empty' })

  useEffect(() => {
    void window.api.listAgents().then(setAgents)
    void window.api.listProjects().then((list) => {
      setProjects(list)
      if (list.length > 0) setProjectId(list[0].id)
    })
    void window.api.listTasks().then(setTasks)
    void window.api.listProcedures().then(setProcedures)

    const offDone = window.api.onTaskDone(() => playDoneChime())
    const offDeleted = window.api.onTaskDeleted((code) => {
      setTasks((prev) => prev.filter((t) => t.code !== code))
      setView((v) => (v.kind === 'task' && v.code === code ? { kind: 'empty' } : v))
    })
    const offChanged = window.api.onTaskChanged((task) =>
      setTasks((prev) => {
        const i = prev.findIndex((t) => t.code === task.code)
        if (i === -1) return [task, ...prev]
        const next = [...prev]
        next[i] = task
        return next
      })
    )
    return () => {
      offDone()
      offDeleted()
      offChanged()
    }
  }, [])

  const project = projects.find((p) => p.id === projectId) ?? null
  const projectTasks = useMemo(() => tasks.filter((t) => t.projectId === projectId), [tasks, projectId])
  const selected = view.kind === 'task' ? tasks.find((t) => t.code === view.code) : undefined
  const projectNames = new Map(projects.map((p) => [p.id, p.name]))
  const visibleProcedures =
    procedureFilter === 'all'
      ? procedures
      : procedures.filter((p) => p.projectIds.includes(procedureFilter))
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
        <div className="brand">
          <img className="brand-mark" src="./icon.png" alt="" aria-hidden="true" />
          <div><h1>TaskQueue</h1><span className="brand-caption">Tu espacio de ejecución</span></div>
        </div>
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
        <UpdateFooter />
      </aside>

      <main className="task-list-pane">
        {section === 'procedures' ? (
          <>
            <div className="pane-header">
              <div><div className="eyebrow">Biblioteca de trabajo</div><h2>Procedimientos</h2></div>
              <select
                className="filter"
                value={procedureFilter}
                onChange={(e) =>
                  setProcedureFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                }
              >
                <option value="all">Todos los proyectos</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="primary" onClick={() => setView({ kind: 'newProcedure' })}>
                Nuevo procedimiento
              </button>
            </div>
            <table className="task-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Título</th>
                  <th>Proyectos</th>
                </tr>
              </thead>
              <tbody>
                {visibleProcedures.map((p) => (
                  <tr
                    key={p.code}
                    className={view.kind === 'procedure' && view.code === p.code ? 'selected' : ''}
                    onClick={() => setView({ kind: 'procedure', code: p.code })}
                  >
                    <td>
                      <code>{p.code}</code>
                    </td>
                    <td>{p.title}</td>
                    <td className="small">
                      {p.projectIds.map((id) => projectNames.get(id)).join(', ') || (
                        <span className="error">sin proyecto</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleProcedures.length === 0 && <p className="muted">No hay procedimientos.</p>}
          </>
        ) : project ? (
          <>
            <div className="pane-header">
              <div>
                <div className="eyebrow">Cola de trabajo</div>
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
                    data-status={t.status}
                    className={view.kind === 'task' && view.code === t.code ? 'selected' : ''}
                    onClick={() => setView({ kind: 'task', code: t.code })}
                  >
                    <td>
                      <code>{t.code}</code>
                    </td>
                    <td>{t.title}</td>
                    <td>
                      {t.agent}
                      {t.model && <span className="muted small"> · {t.model}</span>}
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {projectTasks.length === 0 && <div className="list-empty"><span aria-hidden="true">＋</span><h3>Espacio para tu próxima idea</h3><p className="muted">Crea una tarea para empezar a trabajar en este proyecto.</p></div>}
          </>
        ) : (
          <div className="list-empty"><span aria-hidden="true">＋</span><h3>Todo empieza con un proyecto</h3><p className="muted">Añade un proyecto desde la barra lateral para empezar.</p></div>
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
              procedures={procedures.filter((p) => p.projectIds.includes(project.id))}
              submitLabel="Crear"
              withResources
              gitRepo={project.isGitRepo}
              onCancel={() => setView({ kind: 'empty' })}
              onSubmit={async ({ resourcePaths, ...values }) => {
                const task = await window.api.createTask({ ...values, projectId: project.id })
                if (resourcePaths.length > 0) await window.api.addResources(task.code, resourcePaths)
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
            gitRepo={projects.find((p) => p.id === selected.projectId)?.isGitRepo ?? false}
            onOpenProcedure={openProcedure}
          />
        )}
        {view.kind === 'newProcedure' && (
          <>
            <h2>Nuevo procedimiento</h2>
            <ProcedureForm
              projects={projects}
              initial={{
                title: '',
                prompt: '',
                projectIds:
                  procedureFilter !== 'all' ? [procedureFilter] : projectId !== null ? [projectId] : []
              }}
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
            projects={projects}
            onUpdated={upsertProcedure}
            onDeleted={(code) => {
              setProcedures((prev) => prev.filter((p) => p.code !== code))
              setView({ kind: 'empty' })
            }}
          />
        )}
        {view.kind === 'empty' && (
          <div className="detail-empty">
            <div className="empty-illustration" aria-hidden="true"><i /><i /><i /></div>
            <div className="eyebrow">Todo en su sitio</div>
            <h2>{section === 'procedures' ? 'Cada proceso, a mano' : 'El foco en tu próxima tarea'}</h2>
            <p>{section === 'procedures' ? 'Selecciona un procedimiento para consultar sus instrucciones.' : 'Selecciona una tarea para ver sus detalles, seguir su progreso y trabajar con tu agente.'}</p>
          </div>
        )}
      </section>
    </div>
  )
}
