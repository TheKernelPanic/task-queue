import { useEffect, useState } from 'react'
import type { TaskEvent, TaskEventKind } from '@shared/types'
import Markdown from './Markdown'

const KIND_LABELS: Record<TaskEventKind, string> = {
  text: 'Texto',
  thinking: 'Razonamiento',
  command: 'Comando',
  output: 'Salida',
  system: 'Sistema',
  error: 'Error'
}

/** Only agent text is shown by default; the other kinds are opt-in for the current view. */
const DEFAULT_SHOWN: TaskEventKind[] = ['text']

export default function HistoryView({ code }: { code: string }) {
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [shown, setShown] = useState<Set<TaskEventKind>>(() => new Set(DEFAULT_SHOWN))

  useEffect(() => {
    let active = true
    setEvents([])
    setShown(new Set(DEFAULT_SHOWN))
    void window.api.listEvents(code).then((list) => {
      if (!active) return
      // Keep live events that arrived while the initial list was loading.
      const ids = new Set(list.map((e) => e.id))
      setEvents((prev) => [...list, ...prev.filter((e) => !ids.has(e.id))])
    })
    const off = window.api.onTaskEvent((event) => {
      if (event.taskCode === code) setEvents((prev) => [...prev, event])
    })
    return () => {
      active = false
      off()
    }
  }, [code])

  function toggle(kind: TaskEventKind) {
    setShown((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  // Newest first.
  const visible = events.filter((e) => shown.has(e.kind)).reverse()

  return (
    <div className="history">
      <div className="history-filters">
        {(Object.keys(KIND_LABELS) as TaskEventKind[]).map((kind) => (
          <label key={kind} className={`chip chip-${kind}`}>
            <input type="checkbox" checked={shown.has(kind)} onChange={() => toggle(kind)} />
            {KIND_LABELS[kind]}
          </label>
        ))}
      </div>
      {visible.length === 0 && <p className="muted">Sin eventos todavía.</p>}
      {visible.map((e) => (
        <div key={e.id} className={`event event-${e.kind}`}>
          <div className="event-meta">
            <span>{KIND_LABELS[e.kind]}</span>
            <time>{e.createdAt}</time>
          </div>
          {e.kind === 'text' ? <Markdown>{e.content}</Markdown> : <pre>{e.content}</pre>}
        </div>
      ))}
    </div>
  )
}
