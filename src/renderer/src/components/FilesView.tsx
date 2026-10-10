import { useCallback, useEffect, useRef, useState } from 'react'
import { isTaskEditable, type Task, type TaskFile } from '@shared/types'
import DropZone from './DropZone'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function folderOf(file: TaskFile): string {
  return file.path.slice(0, file.path.length - file.name.length - 1)
}

function ipcMessage(err: unknown): string {
  return (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

interface ListProps {
  files: TaskFile[]
  empty: string
  onRemove?: (file: TaskFile) => void
}

function FileList({ files, empty, onRemove }: ListProps) {
  if (files.length === 0) return <p className="muted small">{empty}</p>
  return (
    <ul className="file-list">
      {files.map((f) => (
        <li key={f.name}>
          <a
            href="#"
            title={f.path}
            onClick={(e) => {
              e.preventDefault()
              void window.api.openPath(f.path)
            }}
          >
            {f.name}
          </a>
          <span className="muted small">{formatSize(f.size)}</span>
          <span className="spacer" />
          <button className="icon" title="Mostrar en carpeta" onClick={() => window.api.showInFolder(f.path)}>
            ⧉
          </button>
          {onRemove && (
            <button className="icon danger" title="Quitar" onClick={() => onRemove(f)}>
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function FilesView({ task }: { task: Task }) {
  const [resources, setResources] = useState<TaskFile[]>([])
  const [outputs, setOutputs] = useState<TaskFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const refreshTimer = useRef<number | undefined>(undefined)

  const refreshOutputs = useCallback(() => {
    void window.api.listOutputs(task.code).then(setOutputs)
  }, [task.code])

  useEffect(() => {
    void window.api.listResources(task.code).then(setResources)
    refreshOutputs()
  }, [task.code, task.status, refreshOutputs])

  // The agent may write outputs at any time; refresh shortly after its activity.
  useEffect(() => {
    const off = window.api.onTaskEvent((event) => {
      if (event.taskCode !== task.code) return
      window.clearTimeout(refreshTimer.current)
      refreshTimer.current = window.setTimeout(refreshOutputs, 1000)
    })
    return () => {
      off()
      window.clearTimeout(refreshTimer.current)
    }
  }, [task.code, refreshOutputs])

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
            <button className="icon" onClick={() => window.api.openPath(folderOf(resources[0]))}>
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
        <FileList
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

      <section>
        <div className="section-title">
          Outputs
          <span>
            <button className="icon" onClick={refreshOutputs} title="Refrescar">
              ↻
            </button>
            {outputs.length > 0 && (
              <button className="icon" onClick={() => window.api.openPath(folderOf(outputs[0]))}>
                Abrir carpeta
              </button>
            )}
          </span>
        </div>
        <p className="muted small">Ficheros generados por el agente que no pertenecen al proyecto.</p>
        <FileList files={outputs} empty="El agente no ha generado outputs." />
      </section>
    </div>
  )
}
