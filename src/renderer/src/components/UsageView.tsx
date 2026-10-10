import { useEffect, useState } from 'react'
import type { ModelUsage, RunStatus, TaskRun, UsageTotals } from '@shared/types'

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: 'En curso',
  success: 'OK',
  error: 'Error',
  cancelled: 'Cancelada',
  interrupted: 'Interrumpida'
}

const WINDOW_LABELS: Record<string, string> = {
  five_hour: 'Sesión (5 h)',
  seven_day: 'Semanal (7 días)'
}

const tokens = (n: number) => n.toLocaleString('es-ES')
const usd = (n: number | null) => (n === null ? '—' : `$${n.toFixed(4)}`)

function duration(ms: number | null): string {
  if (ms === null) return '—'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

function dateTime(iso: string | null): string {
  if (!iso) return '—'
  // SQLite datetime('now') is UTC without zone marker.
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`)
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

function emptyTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: null }
}

function add(into: UsageTotals, u: UsageTotals): void {
  into.inputTokens += u.inputTokens
  into.outputTokens += u.outputTokens
  into.cacheReadTokens += u.cacheReadTokens
  into.cacheCreationTokens += u.cacheCreationTokens
  if (u.costUsd !== null) into.costUsd = (into.costUsd ?? 0) + u.costUsd
}

export default function UsageView({ code }: { code: string }) {
  const [runs, setRuns] = useState<TaskRun[]>([])

  useEffect(() => {
    let active = true
    setRuns([])
    void window.api.listRuns(code).then((list) => active && setRuns(list))
    const off = window.api.onTaskRun((run) => {
      if (run.taskCode !== code) return
      setRuns((prev) => {
        const i = prev.findIndex((r) => r.id === run.id)
        if (i === -1) return [...prev, run]
        const next = [...prev]
        next[i] = run
        return next
      })
    })
    return () => {
      active = false
      off()
    }
  }, [code])

  if (runs.length === 0) return <p className="muted">El agente todavía no se ha ejecutado para esta tarea.</p>

  const totals = emptyTotals()
  const byModel = new Map<string, ModelUsage>()
  let totalDuration = 0
  for (const run of runs) {
    add(totals, run)
    totalDuration += run.durationMs ?? 0
    for (const m of run.models) {
      const agg = byModel.get(m.model) ?? { model: m.model, ...emptyTotals() }
      add(agg, m)
      byModel.set(m.model, agg)
    }
  }
  const quota = [...runs].reverse().find((r) => r.rateLimit)?.rateLimit ?? null

  return (
    <div className="usage-view">
      <div className="stat-row">
        <div className="stat">
          <div className="stat-label">Coste estimado</div>
          <div className="stat-value">{usd(totals.costUsd)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Entrada</div>
          <div className="stat-value">{tokens(totals.inputTokens)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Salida</div>
          <div className="stat-value">{tokens(totals.outputTokens)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Caché (lectura / escritura)</div>
          <div className="stat-value small-value">
            {tokens(totals.cacheReadTokens)} / {tokens(totals.cacheCreationTokens)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Ejecuciones · tiempo</div>
          <div className="stat-value small-value">
            {runs.length} · {duration(totalDuration)}
          </div>
        </div>
      </div>
      <p className="muted small">
        Coste estimado a precio de lista de la API, según lo informa el agente. Con una suscripción no es un
        cargo real.
      </p>

      {quota && Object.keys(quota.windows).length > 0 && (
        <section>
          <div className="section-title">Cuota del plan (cuenta)</div>
          {Object.entries(quota.windows).map(([name, w]) => {
            const pct = Math.round(w.utilization * 100)
            return (
              <div key={name} className="quota">
                <div className="quota-head">
                  <span>{WINDOW_LABELS[name] ?? name}</span>
                  <span>
                    {pct}% · se reinicia {dateTime(w.resetsAt)}
                  </span>
                </div>
                <div className="bar">
                  <div
                    className={`bar-fill${pct >= 90 ? ' danger' : pct >= 70 ? ' warn' : ''}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
          <p className="muted small">
            Estado: {quota.status} · capturado {dateTime(quota.capturedAt)}. Es el uso de toda la cuenta, no
            solo de esta tarea.
          </p>
        </section>
      )}

      <section>
        <div className="section-title">Por modelo</div>
        <table className="usage-table">
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Entrada</th>
              <th>Salida</th>
              <th>Caché lect.</th>
              <th>Caché escr.</th>
              <th>Coste</th>
            </tr>
          </thead>
          <tbody>
            {[...byModel.values()].map((m) => (
              <tr key={m.model}>
                <td>
                  <code>{m.model}</code>
                </td>
                <td>{tokens(m.inputTokens)}</td>
                <td>{tokens(m.outputTokens)}</td>
                <td>{tokens(m.cacheReadTokens)}</td>
                <td>{tokens(m.cacheCreationTokens)}</td>
                <td>{usd(m.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <div className="section-title">Ejecuciones</div>
        <table className="usage-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Inicio</th>
              <th>Agente</th>
              <th>Estado</th>
              <th>Duración</th>
              <th>Turnos</th>
              <th>Entrada</th>
              <th>Salida</th>
              <th>Coste</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td>{dateTime(r.startedAt)}</td>
                <td>{r.agent}</td>
                <td className={`run-${r.status}`}>{RUN_STATUS_LABELS[r.status]}</td>
                <td>{r.status === 'running' ? '…' : duration(r.durationMs)}</td>
                <td>{r.turns ?? '—'}</td>
                <td>{tokens(r.inputTokens + r.cacheReadTokens + r.cacheCreationTokens)}</td>
                <td>{tokens(r.outputTokens)}</td>
                <td>{usd(r.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">En cada ejecución, «Entrada» incluye los tokens de caché.</p>
      </section>
    </div>
  )
}
