import { useEffect, useRef } from 'react'
import type { TaskFile } from '@shared/types'

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Calls `refresh` shortly after the agent's activity on the task (it may write files at any time). */
export function useRefreshOnActivity(code: string, refresh: () => void): void {
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const off = window.api.onTaskEvent((event) => {
      if (event.taskCode !== code) return
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(refresh, 1000)
    })
    return () => {
      off()
      window.clearTimeout(timer.current)
    }
  }, [code, refresh])
}

interface Props {
  files: TaskFile[]
  empty: string
  showModified?: boolean
  onRemove?: (file: TaskFile) => void
}

export default function FileList({ files, empty, showModified, onRemove }: Props) {
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
          {showModified && (
            <span className="muted small">
              {new Date(f.modifiedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
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
