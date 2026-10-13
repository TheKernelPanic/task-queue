import { useEffect, useMemo, useRef, useState } from 'react'
import { TASK_STATUSES, type Task, type TaskStatus } from '@shared/types'
import StatusBadge, { STATUS_LABELS } from './StatusBadge'

const PAGE_SIZE = 50

/** Lowercase without accents, so "codigo" matches "Código". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

interface Props {
  tasks: Task[]
  selectedCode: string | null
  onSelect: (code: string) => void
}

/** Task table with a title/prompt search box and a status filter; rows render in pages as the list scrolls. */
export default function TaskList({ tasks, selectedCode, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<TaskStatus | ''>('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const sentinel = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean)
    if (words.length === 0 && !status) return tasks
    return tasks.filter((t) => {
      if (status && t.status !== status) return false
      const haystack = normalize(`${t.title}\n${t.prompt}`)
      return words.every((w) => haystack.includes(w))
    })
  }, [tasks, query, status])

  const counts = useMemo(() => {
    const byStatus = {} as Record<TaskStatus, number>
    for (const s of TASK_STATUSES) byStatus[s] = 0
    for (const t of tasks) byStatus[t.status]++
    return byStatus
  }, [tasks])

  // Start from the first page whenever the search or filter changes.
  useEffect(() => setLimit(PAGE_SIZE), [query, status])

  const hasMore = filtered.length > limit

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE_SIZE)
      },
      { rootMargin: '300px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, limit])

  return (
    <>
      <div className="task-search">
        <input
          type="search"
          placeholder="Buscar en título y prompt…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | '')}>
          <option value="">Todos los estados</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]} ({counts[s]})
            </option>
          ))}
        </select>
        {(query || status) && (
          <span className="muted small">
            {filtered.length} de {tasks.length}
          </span>
        )}
      </div>
      {filtered.length > 0 && (
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
            {filtered.slice(0, limit).map((t) => (
              <tr
                key={t.code}
                data-status={t.status}
                className={selectedCode === t.code ? 'selected' : ''}
                onClick={() => onSelect(t.code)}
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
      )}
      {hasMore && <div ref={sentinel} className="muted small task-list-more">Cargando más…</div>}
      {tasks.length === 0 ? (
        <div className="list-empty">
          <span aria-hidden="true">＋</span>
          <h3>Espacio para tu próxima idea</h3>
          <p className="muted">Crea una tarea para empezar a trabajar en este proyecto.</p>
        </div>
      ) : (
        filtered.length === 0 && (
          <p className="muted">
            Ninguna tarea coincide
            {query && <> con «{query}»</>}
            {status && <> en estado {STATUS_LABELS[status]}</>}.
          </p>
        )
      )}
    </>
  )
}
