import { useEffect, useMemo, useRef, useState } from 'react'
import { TASK_STATUSES, TASK_TYPES, type Task, type TaskStatus, type TaskType } from '@shared/types'
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
  const [types, setTypes] = useState<TaskType[]>([])
  const [limit, setLimit] = useState(PAGE_SIZE)
  const sentinel = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean)
    if (words.length === 0 && statuses.length === 0 && types.length === 0) return tasks
    return tasks.filter((t) => {
      if (statuses.length > 0 && !statuses.includes(t.status)) return false
      if (types.length > 0 && !types.includes(t.type)) return false
      const haystack = normalize(`${t.title}\n${t.prompt}`)
      return words.every((w) => haystack.includes(w))
    })
  }, [tasks, query, statuses, types])

  const statusCounts = useMemo(() => countBy(tasks, TASK_STATUSES, (t) => t.status), [tasks])
  const typeCounts = useMemo(() => countBy(tasks, TASK_TYPES, (t) => t.type), [tasks])
  const filtering = query !== '' || statuses.length > 0 || types.length > 0

  // Start from the first page whenever the search or filter changes.
  useEffect(() => setLimit(PAGE_SIZE), [query, statuses, types])

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
        <MultiFilter
          options={TASK_STATUSES}
          selected={statuses}
          counts={statusCounts}
          onChange={setStatuses}
          allLabel="Todos los estados"
          pluralLabel="estados"
          ariaLabel="Filtrar por estado"
          label={(s) => STATUS_LABELS[s]}
          renderOption={(s) => <span className={`badge badge-${s}`}>{STATUS_LABELS[s]}</span>}
        />
        <MultiFilter
          options={TASK_TYPES}
          selected={types}
          counts={typeCounts}
          onChange={setTypes}
          allLabel="Todos los tipos"
          pluralLabel="tipos"
          ariaLabel="Filtrar por tipo"
          label={(t) => t}
          renderOption={(t) => (
            <span className="multi-filter-type">
              <TaskTypeIcon type={t} />
              {t}
            </span>
          )}
        />
        {filtering && (
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
            {statuses.length > 1 && <> en los estados seleccionados</>}
            {types.length === 1 && <> de tipo {types[0]}</>}
            {types.length > 1 && <> de los tipos seleccionados</>}.
          </p>
        )
      )}
    </>
  )
}

function countBy<K extends string>(tasks: Task[], keys: readonly K[], key: (t: Task) => K): Record<K, number> {
  const counts = {} as Record<K, number>
  for (const k of keys) counts[k] = 0
  for (const t of tasks) counts[key(t)]++
  return counts
}

interface MultiFilterProps<T extends string> {
  options: readonly T[]
  selected: T[]
  counts: Record<T, number>
  onChange: (selected: T[]) => void
  /** Button text when nothing is selected. */
  allLabel: string
  /** Noun used in "N <pluralLabel>" when several are selected. */
  pluralLabel: string
  ariaLabel: string
  label: (value: T) => string
  renderOption: (value: T) => React.ReactNode
}

/** Dropdown with a checkbox per option; an empty selection means every option. */
function MultiFilter<T extends string>({
  options,
  selected,
  counts,
  onChange,
  allLabel,
  pluralLabel,
  ariaLabel,
  label,
  renderOption
}: MultiFilterProps<T>) {
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

  function toggle(value: T) {
    // Keep the canonical option order regardless of click order.
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : options.filter((v) => v === value || selected.includes(v))
    onChange(next)
  }

  const text =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? label(selected[0])
        : `${selected.length} ${pluralLabel}`

  return (
    <div className="multi-filter" ref={root}>
      <button
        type="button"
        className={`multi-filter-toggle${selected.length > 0 ? ' filtering' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {text} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="multi-filter-menu" role="group" aria-label={ariaLabel}>
          {options.map((v) => (
            <label key={v} className="multi-filter-option">
              <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} />
              {renderOption(v)}
              <span className="muted small">{counts[v]}</span>
            </label>
          ))}
          <div className="multi-filter-actions">
            <button type="button" disabled={selected.length === 0} onClick={() => onChange([])}>
              Limpiar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
