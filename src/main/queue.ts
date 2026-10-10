import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { MANUAL_TRANSITIONS, type Task, type TaskStatus } from '@shared/types'
import * as db from './db'
import { adapters, resolveAgentPath } from './agents'
import { commitTask, getCommit as gitGetCommit } from './git'
import { getMcpEndpoint } from './mcp'
import { outputsDir, resourcesDir } from './storage'

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
    outputsDir: outputsDir(task.code, true)
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

  let result: string | undefined
  const stderr: string[] = []

  createInterface({ input: child.stdout! }).on('line', (line) => {
    if (!line.trim()) return
    try {
      const parsed = adapter.parseLine(line)
      if (parsed.sessionId && parsed.sessionId !== db.getTask(task.code)?.sessionId) {
        db.patchTask(task.code, { sessionId: parsed.sessionId })
      }
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
    void finalize(task.code, run, exitCode, result, stderr.join('')).finally(() => void tick())
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
  if (run && (status === 'Stopped' || status === 'Cancelled' || status === 'Created')) {
    run.cancelled = true
    killTree(run.child)
  }

  db.addEvent(code, 'system', `Status changed manually: ${task.status} → ${status}`)
  const updated = db.patchTask(code, { status })
  if (status === 'Pending') void tick()
  return updated
}

export function answerQuestion(code: string, answer: string): Task {
  const task = db.getTask(code)
  if (!task) throw new Error(`Task ${code} not found`)
  if (task.status !== 'WaitingForInput') throw new Error(`Task ${code} is not waiting for input`)
  db.addEvent(code, 'system', `User answer: ${answer}`)
  const updated = db.patchTask(code, { answer, status: 'Pending' })
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
