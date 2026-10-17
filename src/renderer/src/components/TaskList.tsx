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
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [limit, setLimit] = useState(PAGE_SIZE)
  const sentinel = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean)
    if (words.length === 0 && statuses.length === 0) return tasks
    return tasks.filter((t) => {
      if (statuses.length > 0 && !statuses.includes(t.status)) return false
      const haystack = normalize(`${t.title}\n${t.prompt}`)
      return words.every((w) => haystack.includes(w))
    })
  }, [tasks, query, statuses])

  const counts = useMemo(() => {
    const byStatus = {} as Record<TaskStatus, number>
    for (const s of TASK_STATUSES) byStatus[s] = 0
    for (const t of tasks) byStatus[t.status]++
    return byStatus
  }, [tasks])

  // Start from the first page whenever the search or filter changes.
  useEffect(() => setLimit(PAGE_SIZE), [query, statuses])

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
        <StatusFilter selected={statuses} counts={counts} onChange={setStatuses} />
        {(query || statuses.length > 0) && (
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
            {statuses.length === 1 && <> en estado {STATUS_LABELS[statuses[0]]}</>}
            {statuses.length > 1 && <> en los estados seleccionados</>}.
          </p>
        )
      )}
    </>
  )
}

interface StatusFilterProps {
  selected: TaskStatus[]
  counts: Record<TaskStatus, number>
  onChange: (statuses: TaskStatus[]) => void
}

/** Dropdown with a checkbox per status; an empty selection means every status. */
function StatusFilter({ selected, counts, onChange }: StatusFilterProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle(status: TaskStatus) {
    // Keep the canonical status order regardless of click order.
    const next = selected.includes(status)
      ? selected.filter((s) => s !== status)
      : TASK_STATUSES.filter((s) => s === status || selected.includes(s))
    onChange(next)
  }

  const label =
    selected.length === 0
      ? 'Todos los estados'
      : selected.length === 1
        ? STATUS_LABELS[selected[0]]
        : `${selected.length} estados`

  return (
    <div className="status-filter" ref={root}>
      <button
        type="button"
        className={`status-filter-toggle${selected.length > 0 ? ' filtering' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="status-filter-menu" role="group" aria-label="Filtrar por estado">
          {TASK_STATUSES.map((s) => (
            <label key={s} className="status-filter-option">
              <input type="checkbox" checked={selected.includes(s)} onChange={() => toggle(s)} />
              <span className={`badge badge-${s}`}>{STATUS_LABELS[s]}</span>
              <span className="muted small">{counts[s]}</span>
            </label>
          ))}
          <div className="status-filter-actions">
            <button type="button" disabled={selected.length === 0} onClick={() => onChange([])}>
              Limpiar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
