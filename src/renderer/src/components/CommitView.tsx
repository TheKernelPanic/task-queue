import { useEffect, useMemo, useState } from 'react'
import type { CommitInfo } from '@shared/types'

export function parseDiff(diff: string) {
  let oldLine = 0, newLine = 0, added = 0, removed = 0
  let inHunk = false
  const rows = diff.trimEnd().split('\n').flatMap((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true
      return [{ kind: 'hunk', text, old: '', next: '', marker: '' }]
    }
    if (!inHunk) return []
    if (text.startsWith('+')) {
      added++
      return [{ kind: 'add', text: text.slice(1), old: '', next: String(newLine++), marker: '+' }]
    }
    if (text.startsWith('-')) {
      removed++
      return [{ kind: 'del', text: text.slice(1), old: String(oldLine++), next: '', marker: '−' }]
    }
    if (text.startsWith(' ')) return [{ kind: 'context', text: text.slice(1), old: String(oldLine++), next: String(newLine++), marker: '' }]
    return [{ kind: 'note', text, old: '', next: '', marker: '' }]
  })
  const status = /^new file mode /m.test(diff) ? 'Nuevo' : /^deleted file mode /m.test(diff) ? 'Eliminado' : /^rename from /m.test(diff) ? 'Renombrado' : 'Modificado'
  return { rows, added, removed, status }
}

function Stats({ added, removed }: { added: number; removed: number }) {
  return <span className="diff-stats"><span className="diff-stat-add" aria-label={`${added} líneas añadidas`}>+{added}</span><span className="diff-stat-del" aria-label={`${removed} líneas eliminadas`}>−{removed}</span></span>
}

export default function CommitView({ code }: { code: string }) {
  const [commit, setCommit] = useState<CommitInfo | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [wrap, setWrap] = useState(false)
  const [filter, setFilter] = useState('')
  const files = useMemo(() => commit?.files.map((file) => ({ ...file, ...parseDiff(file.diff) })) ?? [], [commit])

  useEffect(() => {
    let active = true
    setCommit(undefined); setError(null); setSelected(0); setFilter('')
    window.api.getCommit(code)
      .then((value) => { if (active) setCommit(value) })
      .catch((err: Error) => { if (active) setError(err.message) })
    return () => { active = false }
  }, [code])

  if (error) return <div className="commit-empty error" role="alert">{error}</div>
  if (commit === undefined) return <div className="commit-empty" role="status">Cargando cambios…</div>
  if (commit === null) return <div className="commit-empty">Esta tarea no tiene commit.</div>
  const file = files[selected]
  const totals = files.reduce((sum, f) => ({ added: sum.added + f.added, removed: sum.removed + f.removed }), { added: 0, removed: 0 })
  const visible = files.map((f, index) => ({ ...f, index })).filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
  const date = new Date(commit.date)

  return <div className="commit">
    <header className="commit-header">
      <div className="commit-summary"><span className="eyebrow">Cambios del commit</span><code title={commit.hash}>{commit.hash.slice(0, 10)}</code></div>
      <p className="commit-message">{commit.message}</p>
      <div className="commit-meta"><span>{commit.author}</span><time dateTime={commit.date}>{Number.isNaN(date.getTime()) ? commit.date : date.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
      <div className="commit-summary commit-totals"><span>{files.length} {files.length === 1 ? 'archivo cambiado' : 'archivos cambiados'}</span><Stats {...totals} /></div>
    </header>
    {files.length === 0 ? <div className="commit-empty">No hay cambios de archivos disponibles para este commit.</div> : <div className="commit-body">
      <nav className="commit-file-panel" aria-label="Archivos del commit">
        <div className="commit-file-search"><label htmlFor={`diff-filter-${code}`}>Archivos <span>{files.length}</span></label><input id={`diff-filter-${code}`} type="search" placeholder="Filtrar por ruta…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <ul className="commit-files">{visible.map((f) => <li key={f.path}><button type="button" className={f.index === selected ? 'selected' : ''} aria-current={f.index === selected ? 'true' : undefined} onClick={() => setSelected(f.index)} title={f.path}><span className="commit-file-name">{f.path.split('/').pop()}</span><span className="commit-file-path">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : 'Directorio raíz'}</span><span className="commit-file-info"><span>{f.status}</span><Stats added={f.added} removed={f.removed} /></span></button></li>)}</ul>
        {visible.length === 0 && <p className="commit-empty">No hay archivos que coincidan.</p>}
      </nav>
      {file && <section className="diff-panel" aria-label={`Cambios en ${file.path}`}>
        <div className="diff-toolbar"><div className="diff-file-heading"><strong>{file.path}</strong><span>{file.status} <Stats added={file.added} removed={file.removed} /></span></div><button type="button" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>Ajustar líneas</button></div>
        {file.rows.length > 0 ? <div key={file.path} className={`diff${wrap ? ' diff-wrap' : ''}`} tabIndex={0} role="region" aria-label="Diff unificado: línea anterior y línea nueva"><div className="diff-lines">{file.rows.map((row, i) => <div key={i} className={`diff-row diff-${row.kind}`}><span className="diff-line-number" aria-hidden="true">{row.old}</span><span className="diff-line-number" aria-hidden="true">{row.next}</span><span className="diff-marker" aria-hidden="true">{row.marker}</span><code>{row.text || ' '}</code></div>)}</div></div> : <div className="commit-empty"><strong>{/Binary files|GIT binary patch/.test(file.diff) ? 'Archivo binario' : 'Sin cambios de texto'}</strong><p>{/Binary files|GIT binary patch/.test(file.diff) ? 'No hay una vista de texto disponible para este archivo.' : 'El cambio afecta al nombre o a los metadatos del archivo.'}</p></div>}
      </section>}
    </div>}
  </div>
}
