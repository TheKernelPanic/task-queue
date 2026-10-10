import { useCallback, useEffect, useState } from 'react'
import type { Task, TaskFile } from '@shared/types'
import FileList, { formatSize, useRefreshOnActivity } from './FileList'

export default function WorkspaceView({ task }: { task: Task }) {
  const [files, setFiles] = useState<TaskFile[]>([])
  const [truncated, setTruncated] = useState(false)

  const refresh = useCallback(() => {
    void window.api.listWorkspace(task.code).then((r) => {
      setFiles(r.files)
      setTruncated(r.truncated)
    })
  }, [task.code])

  useEffect(refresh, [refresh, task.status])
  useRefreshOnActivity(task.code, refresh)

  const total = files.reduce((acc, f) => acc + f.size, 0)

  return (
    <div className="files-view">
      <section>
        <div className="section-title">
          Directorio de trabajo
          <span>
            <button className="icon" onClick={refresh} title="Refrescar">
              ↻
            </button>
            <button className="icon" onClick={() => window.api.openTaskFolder(task.code, 'workspace')}>
              Abrir carpeta
            </button>
          </span>
        </div>
        <p className="muted small">
          Lo que el agente crea fuera del proyecto para trabajar: copias de seguridad, ficheros temporales,
          clones… Se le indica en <code>workspaceDir</code>.
        </p>
        {files.length > 0 && (
          <p className="muted small">
            {files.length}
            {truncated ? '+' : ''} ficheros · {formatSize(total)}
            {truncated && ' · lista recortada; abre la carpeta para ver todo'}
          </p>
        )}
        <FileList files={files} empty="El agente no ha creado nada en su directorio de trabajo." showModified />
      </section>
    </div>
  )
}
