import { useCallback, useEffect, useState } from 'react'
import { isTaskEditable, type Task, type TaskFile } from '@shared/types'
import DropZone from './DropZone'
import FileCards from './FileCards'
import { useRefreshOnActivity } from './FileList'

function ipcMessage(err: unknown): string {
  return (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export default function FilesView({ task }: { task: Task }) {
  const [resources, setResources] = useState<TaskFile[]>([])
  const [outputs, setOutputs] = useState<TaskFile[]>([])
  const [answerFiles, setAnswerFiles] = useState<TaskFile[]>([])
  const [error, setError] = useState<string | null>(null)

  const refreshOutputs = useCallback(() => {
    void window.api.listOutputs(task.code).then(setOutputs)
  }, [task.code])

  useEffect(() => {
    void window.api.listResources(task.code).then(setResources)
    void window.api.listAnswerFiles(task.code).then(setAnswerFiles)
    refreshOutputs()
  }, [task.code, task.status, refreshOutputs])

  useRefreshOnActivity(task.code, refreshOutputs)

  async function run(action: () => Promise<TaskFile[]>) {
    setError(null)
    try {
      setResources(await action())
    } catch (err) {
      setError(ipcMessage(err))
    }
  }

  const locked = !isTaskEditable(task)

  return (
    <div className="files-view">
      <section>
        <div className="section-title">
          Recursos
          {resources.length > 0 && (
            <button className="icon" onClick={() => window.api.openTaskFolder(task.code, 'resources')}>
              Abrir carpeta
            </button>
          )}
        </div>
        <p className="muted small">
          El agente recibe sus rutas absolutas en las instrucciones de la tarea.
          {locked && ' La tarea ya se ha encolado: los recursos no pueden modificarse.'}
        </p>
        {!locked && (
          <DropZone onPaths={(paths) => run(() => window.api.addResources(task.code, paths))} />
        )}
        {error && <div className="error">{error}</div>}
        <FileCards
          files={resources}
          empty="Sin recursos."
          onRemove={
            locked
              ? undefined
              : (f) => {
                  if (window.confirm(`¿Quitar ${f.name}?`)) {
                    void run(() => window.api.removeResource(task.code, f.name))
                  }
                }
          }
        />
      </section>

      {answerFiles.length > 0 && (
        <section>
          <div className="section-title">Adjuntos de respuestas</div>
          <p className="muted small">Ficheros enviados al responder preguntas del agente.</p>
          <FileCards files={answerFiles} empty="" />
        </section>
      )}

      <section>
        <div className="section-title">
          Outputs
          <span>
            <button className="icon" onClick={refreshOutputs} title="Refrescar">
              ↻
            </button>
            <button className="icon" onClick={() => window.api.openTaskFolder(task.code, 'outputs')}>
              Abrir carpeta
            </button>
          </span>
        </div>
        <p className="muted small">Entregables generados por el agente que no pertenecen al proyecto.</p>
        <FileCards files={outputs} empty="El agente no ha generado outputs." />
      </section>
    </div>
  )
}
