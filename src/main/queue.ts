import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  isTaskDeletable,
  MANUAL_TRANSITIONS,
  type ModelUsage,
  type RunStatus,
  type Task,
  type TaskRun,
  type TaskStatus
} from '@shared/types'
import * as db from './db'
import { adapters, resolveAgentPath } from './agents'
import type { UsageReport } from './agents/types'
import { commitTask, getCommit as gitGetCommit } from './git'
import { getMcpEndpoint } from './mcp'
import {
  addAnswerFiles,
  answersDir,
  outputsDir,
  removeTaskFolders,
  resourcesDir,
  workspaceDir
} from './storage'

const POLL_MS = 3000

interface RunningTask {
  child: ChildProcess
  projectId: number
  cancelled: boolean
}

const running = new Map<string, RunningTask>()
let ticking = false

function busyProject(projectId: number): boolean {
  for (const r of running.values()) if (r.projectId === projectId) return true
  return false
}

function buildPrompt(task: Task): string {
  if (task.sessionId && task.answer) {
    return `The user answered your question.\nQuestion: ${task.question}\nAnswer: ${task.answer}\nContinue with task ${task.code}.`
  }
  if (task.sessionId) return `Continue working on task ${task.code}.`
  return task.code
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => undefined)
  } else {
    child.kill('SIGTERM')
  }
}

const sumCost = (a: number | null, b: number | null): number | null =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0)

const subCost = (a: number | null, b: number | null): number | null =>
  a === null ? null : Math.max(0, a - (b ?? 0))

/** Turns a session-cumulative report into this run's share by subtracting earlier runs of the session. */
function sessionDelta(report: UsageReport, previous: TaskRun[]): UsageReport {
  if (previous.length === 0) return report
  const prevModels = new Map<string, ModelUsage>()
  for (const run of previous) {
    for (const m of run.models) {
      const acc = prevModels.get(m.model)
      prevModels.set(
        m.model,
        acc
          ? {
              model: m.model,
              inputTokens: acc.inputTokens + m.inputTokens,
              outputTokens: acc.outputTokens + m.outputTokens,
              cacheReadTokens: acc.cacheReadTokens + m.cacheReadTokens,
              cacheCreationTokens: acc.cacheCreationTokens + m.cacheCreationTokens,
              costUsd: sumCost(acc.costUsd, m.costUsd)
            }
          : { ...m }
      )
    }
  }
  const prevCost = previous.reduce<number | null>((acc, r) => sumCost(acc, r.costUsd), null)
  const prevApi = previous.reduce((acc, r) => acc + (r.apiDurationMs ?? 0), 0)
  return {
    ...report,
    costUsd: subCost(report.costUsd, prevCost),
    apiDurationMs:
      report.apiDurationMs === undefined ? undefined : Math.max(0, report.apiDurationMs - prevApi),
    models: report.models.map((m) => {
      const p = prevModels.get(m.model)
      if (!p) return m
      return {
        model: m.model,
        inputTokens: Math.max(0, m.inputTokens - p.inputTokens),
        outputTokens: Math.max(0, m.outputTokens - p.outputTokens),
        cacheReadTokens: Math.max(0, m.cacheReadTokens - p.cacheReadTokens),
        cacheCreationTokens: Math.max(0, m.cacheCreationTokens - p.cacheCreationTokens),
        costUsd: subCost(m.costUsd, p.costUsd)
      }
    })
  }
}

/** Adds a usage report to what the run has accumulated so far. */
function addUsage(current: TaskRun, report: UsageReport): db.RunPatch {
  const models = new Map<string, ModelUsage>(current.models.map((m) => [m.model, { ...m }]))
  for (const m of report.models) {
    const prev = models.get(m.model)
    models.set(
      m.model,
      prev
        ? {
            model: m.model,
            inputTokens: prev.inputTokens + m.inputTokens,
            outputTokens: prev.outputTokens + m.outputTokens,
            cacheReadTokens: prev.cacheReadTokens + m.cacheReadTokens,
            cacheCreationTokens: prev.cacheCreationTokens + m.cacheCreationTokens,
            costUsd: sumCost(prev.costUsd, m.costUsd)
          }
        : { ...m }
    )
  }
  return {
    inputTokens: current.inputTokens + report.inputTokens,
    outputTokens: current.outputTokens + report.outputTokens,
    cacheReadTokens: current.cacheReadTokens + report.cacheReadTokens,
    cacheCreationTokens: current.cacheCreationTokens + report.cacheCreationTokens,
    costUsd: sumCost(current.costUsd, report.costUsd),
    models: [...models.values()],
    durationMs: report.durationMs ?? current.durationMs,
    apiDurationMs: report.apiDurationMs ?? current.apiDurationMs,
    turns:
      report.turns === undefined ? current.turns : (current.turns ?? 0) + report.turns
  }
}

async function launch(task: Task): Promise<void> {
  const project = db.getProject(task.projectId)
  if (!project) {
    db.addEvent(task.code, 'error', 'Project not found')
    db.patchTask(task.code, { status: 'Stopped' })
    return
  }

  const adapter = adapters[task.agent]
  const executable = await resolveAgentPath(task.agent)
  if (!executable) {
    db.addEvent(task.code, 'error', `${adapter.name} is not installed or not in PATH`)
    db.patchTask(task.code, { status: 'Stopped' })
    return
  }

  const args = adapter.buildArgs({
    task,
    project,
    mcp: getMcpEndpoint(),
    prompt: buildPrompt(task),
    resumeSessionId: task.sessionId,
    resourcesDir: resourcesDir(task.code, true),
    outputsDir: outputsDir(task.code, true),
    answersDir: answersDir(task.code, true),
    workspaceDir: workspaceDir(task.code, true)
  })

  db.addEvent(
    task.code,
    'system',
    `Launching ${adapter.name}${task.sessionId ? ` (resuming ${task.sessionId})` : ''} in ${project.path}`
  )

  const child = spawn(executable, args, {
    cwd: project.path,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: process.env
  })
  const run: RunningTask = { child, projectId: project.id, cancelled: false }
  running.set(task.code, run)
  const runId = db.startRun(task.code, task.agent).id
  const startedAt = Date.now()

  let result: string | undefined
  let reportedError = false
  const stderr: string[] = []

  createInterface({ input: child.stdout! }).on('line', (line) => {
    if (!line.trim()) return
    try {
      const parsed = adapter.parseLine(line)
      if (parsed.sessionId) {
        if (parsed.sessionId !== db.getTask(task.code)?.sessionId) {
          db.patchTask(task.code, { sessionId: parsed.sessionId })
        }
        if (!db.getRun(runId)?.sessionId) db.patchRun(runId, { sessionId: parsed.sessionId })
      }
      if (parsed.usage) {
        reportedError ||= parsed.usage.isError === true
        const current = db.getRun(runId)!
        const report = parsed.usage.sessionCumulative
          ? sessionDelta(
              parsed.usage,
              db
                .listRuns(task.code)
                .filter((r) => r.id < runId && r.sessionId && r.sessionId === current.sessionId)
            )
          : parsed.usage
        db.patchRun(runId, addUsage(current, report))
      }
      if (parsed.rateLimit) db.patchRun(runId, { rateLimit: parsed.rateLimit })
      if (parsed.result) result = parsed.result
      for (const e of parsed.events) db.addEvent(task.code, e.kind, e.content)
    } catch {
      db.addEvent(task.code, 'output', line)
    }
  })
  child.stderr!.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')))

  child.on('error', (err) => {
    db.addEvent(task.code, 'error', `Failed to start agent: ${err.message}`)
  })

  child.on('close', (exitCode) => {
    running.delete(task.code)
    const status: RunStatus = run.cancelled
      ? 'cancelled'
      : exitCode === 0 && !reportedError
        ? 'success'
        : 'error'
    // Agents that don't report duration get the wall-clock time of the process.
    const durationMs = db.getRun(runId)?.durationMs ?? Date.now() - startedAt
    db.patchRun(runId, { status, durationMs }, true)
    const rawStderr = stderr.join('')
    const cleanStderr = adapter.cleanStderr ? adapter.cleanStderr(rawStderr) : rawStderr
    void finalize(task.code, run, exitCode, result, cleanStderr).finally(() => void tick())
  })
}

async function finalize(
  code: string,
  run: RunningTask,
  exitCode: number | null,
  result: string | undefined,
  stderr: string
): Promise<void> {
  if (stderr.trim()) db.addEvent(code, 'error', stderr.trim())
  if (run.cancelled) return

  const task = db.getTask(code)
  if (!task) return

  if (task.status === 'Done') {
    db.patchTask(code, { question: null, answer: null })
    const project = db.getProject(task.projectId)
    if (project?.isGitRepo) {
      try {
        const hash = await commitTask(project.path, task)
        if (hash) {
          db.patchTask(code, { commitHash: hash })
          db.addEvent(code, 'system', `Committed ${hash.slice(0, 8)}`)
        } else {
          db.addEvent(code, 'system', 'No changes to commit')
        }
      } catch (err) {
        db.addEvent(code, 'error', `Commit failed: ${(err as Error).message}`)
      }
    }
    return
  }

  if (task.status === 'WaitingForInput') return

  // The agent exited without completing nor asking: leave it Stopped for review.
  db.addEvent(
    code,
    'error',
    `Agent exited (code ${exitCode}) without calling complete_task; task stopped`
  )
  db.patchTask(code, {
    status: 'Stopped',
    summary: task.summary ?? result ?? null
  })
}

export async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    for (const task of db.listPendingTasks()) {
      if (running.has(task.code) || busyProject(task.projectId)) continue
      await launch(task)
    }
  } finally {
    ticking = false
  }
}

export function startQueue(): void {
  // Anything left running from a previous session cannot be reattached.
  db.interruptRunningRuns()
  for (const task of db.listTasks()) {
    if (task.status === 'InProgress') {
      db.addEvent(task.code, 'error', 'TaskQueue was closed while the task was running')
      db.patchTask(task.code, { status: 'Stopped' })
    }
  }
  setInterval(() => void tick(), POLL_MS)
  void tick()
}

export function stopAll(): void {
  for (const r of running.values()) {
    r.cancelled = true
    killTree(r.child)
  }
}

export function setStatus(code: string, status: TaskStatus): Task {
  const task = db.getTask(code)
  if (!task) throw new Error(`Task ${code} not found`)
  if (!MANUAL_TRANSITIONS[task.status].includes(status)) {
    throw new Error(`Cannot move ${code} from ${task.status} to ${status}`)
  }

  const run = running.get(code)
  if (run && (status === 'Stopped' || status === 'Cancelled')) {
    run.cancelled = true
    killTree(run.child)
  }

  if (task.status === 'Created' && status === 'Pending') {
    // From now on the task follows these versions even if the procedures are edited.
    db.snapshotTaskProcedures(code)
  }

  db.addEvent(code, 'system', `Status changed manually: ${task.status} → ${status}`)
  const updated = db.patchTask(code, { status })
  if (status === 'Pending') void tick()
  return updated
}

export function deleteTask(code: string): void {
  const task = db.getTask(code)
  if (!task) throw new Error(`Task ${code} not found`)
  if (!isTaskDeletable(task)) throw new Error('Solo se pueden borrar tareas canceladas')
  // A just-cancelled agent may still be shutting down; its close handler updates the task.
  if (running.has(code)) throw new Error('El agente todavía se está deteniendo; inténtalo en unos segundos')

  // Folders first: if a file is locked (e.g. open in another app) the task is kept intact.
  try {
    removeTaskFolders(code)
  } catch (err) {
    throw new Error(`No se pudieron borrar los ficheros de la tarea: ${(err as Error).message}`)
  }
  db.deleteTask(code)
}

export function answerQuestion(code: string, answer: string, paths: string[] = []): Task {
  const task = db.getTask(code)
  if (!task) throw new Error(`Task ${code} not found`)
  if (task.status !== 'WaitingForInput') throw new Error(`Task ${code} is not waiting for input`)
  if (!answer.trim() && paths.length === 0) throw new Error('La respuesta está vacía')

  // Attached files are stored apart from the (locked) resources; the answer lists their absolute paths.
  const attached = paths.length > 0 ? addAnswerFiles(code, paths) : []
  const fullAnswer = attached.length
    ? `${answer.trim()}\n\nAttached files:\n${attached.map((p) => `- ${p}`).join('\n')}`.trim()
    : answer.trim()

  db.addEvent(code, 'system', `User answer: ${fullAnswer}`)
  const updated = db.patchTask(code, { answer: fullAnswer, status: 'Pending' })
  void tick()
  return updated
}

export async function getCommit(code: string) {
  const task = db.getTask(code)
  if (!task?.commitHash) return null
  const project = db.getProject(task.projectId)
  if (!project) return null
  return gitGetCommit(project.path, task.commitHash)
}
