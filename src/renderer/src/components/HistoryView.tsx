import { useEffect, useRef, useState } from 'react'
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

export default function HistoryView({ code }: { code: string }) {
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [hidden, setHidden] = useState<Set<TaskEventKind>>(new Set())
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    setEvents([])
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

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [events.length])

  function toggle(kind: TaskEventKind) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const visible = events.filter((e) => !hidden.has(e.kind))

  return (
    <div className="history">
      <div className="history-filters">
        {(Object.keys(KIND_LABELS) as TaskEventKind[]).map((kind) => (
          <label key={kind} className={`chip chip-${kind}`}>
            <input type="checkbox" checked={!hidden.has(kind)} onChange={() => toggle(kind)} />
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
      <div ref={bottom} />
    </div>
  )
}
