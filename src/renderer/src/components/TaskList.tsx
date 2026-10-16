import { useEffect, useMemo, useRef, useState } from 'react'
import { TASK_STATUSES, type Task, type TaskStatus } from '@shared/types'
import TaskTypeIcon from './TaskTypeIcon'
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

/** Searchable task cards, rendered in pages as the list scrolls. */
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
        <ul className="task-cards" aria-label="Tareas">
          {filtered.slice(0, limit).map((t) => (
            <li key={t.code}>
              <button
                type="button"
                data-status={t.status}
                className={`task-card${selectedCode === t.code ? ' selected' : ''}`}
                aria-pressed={selectedCode === t.code}
                onClick={() => onSelect(t.code)}
              >
                <span className="task-card-header">
                  <code className="task-card-code">{t.code}</code>
                  <StatusBadge status={t.status} />
                </span>
                <span className="task-card-title"><TaskTypeIcon type={t.type} /><span>{t.title}</span></span>
                <span className="task-card-meta">
                  <span>{t.agent === 'codex' ? 'Codex' : 'Claude'}</span>
                  {t.model && <span className="task-card-model">{t.model}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
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
