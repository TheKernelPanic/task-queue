import { useEffect, useState } from 'react'
import type { CommitInfo } from '@shared/types'

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'diff-file'
  if (line.startsWith('+')) return 'diff-add'
  if (line.startsWith('-')) return 'diff-del'
  if (line.startsWith('@@')) return 'diff-hunk'
  return ''
}

export default function CommitView({ code }: { code: string }) {
  const [commit, setCommit] = useState<CommitInfo | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    setCommit(undefined)
    setSelected(0)
    window.api
      .getCommit(code)
      .then(setCommit)
      .catch((err: Error) => setError(err.message))
  }, [code])

  if (error) return <div className="error">{error}</div>
  if (commit === undefined) return <p className="muted">Cargando…</p>
  if (commit === null) return <p className="muted">Esta tarea no tiene commit.</p>

  const file = commit.files[selected]

  return (
    <div className="commit">
      <div className="commit-header">
        <code>{commit.hash.slice(0, 10)}</code> · {commit.author} · {commit.date}
        <pre>{commit.message}</pre>
      </div>
      <div className="commit-body">
        <ul className="commit-files">
          {commit.files.map((f, i) => (
            <li key={f.path} className={i === selected ? 'selected' : ''} onClick={() => setSelected(i)}>
              {f.path}
            </li>
          ))}
        </ul>
        <pre className="diff">
          {file?.diff.split('\n').map((line, i) => (
            <div key={i} className={lineClass(line)}>
              {line || ' '}
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}
