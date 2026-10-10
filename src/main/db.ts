import { DatabaseSync } from 'node:sqlite'
import { EventEmitter } from 'node:events'
import type {
  NewProject,
  NewTask,
  Procedure,
  ProcedureInput,
  Project,
  Task,
  TaskEvent,
  TaskEventKind,
  TaskStatus,
  TaskUpdate
} from '@shared/types'

const TASK_PREFIX = 'DK'
const PROCEDURE_PREFIX = 'PR'

/** Emits 'task' (Task) and 'event' (TaskEvent) whenever data changes. */
export const bus = new EventEmitter()

let db: DatabaseSync

export function openDatabase(file: string): void {
  db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      is_git_repo INTEGER NOT NULL DEFAULT 0,
      permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      code TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      agent TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Created',
      summary TEXT,
      question TEXT,
      answer TEXT,
      session_id TEXT,
      commit_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_code TEXT NOT NULL REFERENCES tasks(code) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS procedures (
      code TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_procedures (
      task_code TEXT NOT NULL REFERENCES tasks(code) ON DELETE CASCADE,
      procedure_code TEXT NOT NULL REFERENCES procedures(code),
      position INTEGER NOT NULL,
      PRIMARY KEY (task_code, procedure_code)
    );

    CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_code, id);
  `)
}

type Row = Record<string, unknown>

function toProject(r: Row): Project {
  return {
    id: r.id as number,
    name: r.name as string,
    path: r.path as string,
    isGitRepo: r.is_git_repo === 1,
    permissionMode: r.permission_mode as Project['permissionMode'],
    createdAt: r.created_at as string
  }
}

function toTask(r: Row): Task {
  return {
    code: r.code as string,
    projectId: r.project_id as number,
    title: r.title as string,
    prompt: r.prompt as string,
    agent: r.agent as Task['agent'],
    status: r.status as TaskStatus,
    summary: (r.summary as string) ?? null,
    question: (r.question as string) ?? null,
    answer: (r.answer as string) ?? null,
    sessionId: (r.session_id as string) ?? null,
    commitHash: (r.commit_hash as string) ?? null,
    procedures: taskProcedureCodes(r.code as string),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  }
}

function toProcedure(r: Row): Procedure {
  return {
    code: r.code as string,
    title: r.title as string,
    prompt: r.prompt as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  }
}

function toEvent(r: Row): TaskEvent {
  return {
    id: r.id as number,
    taskCode: r.task_code as string,
    kind: r.kind as TaskEventKind,
    content: r.content as string,
    createdAt: r.created_at as string
  }
}

// ---- Projects ----

export function listProjects(): Project[] {
  return (db.prepare('SELECT * FROM projects ORDER BY name').all() as Row[]).map(toProject)
}

export function getProject(id: number): Project | null {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
  return r ? toProject(r) : null
}

export function createProject(input: NewProject, isGitRepo: boolean): Project {
  const r = db
    .prepare(
      'INSERT INTO projects (name, path, is_git_repo, permission_mode) VALUES (?, ?, ?, ?) RETURNING *'
    )
    .get(input.name, input.path, isGitRepo ? 1 : 0, input.permissionMode ?? 'acceptEdits') as Row
  return toProject(r)
}

export function deleteProject(id: number): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

// ---- Tasks ----

function nextCode(counter: string, prefix: string): string {
  const r = db
    .prepare(
      `INSERT INTO counters (name, value) VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET value = value + 1
       RETURNING value`
    )
    .get(counter) as Row
  return `${prefix}-${String(r.value).padStart(4, '0')}`
}

function transaction<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function taskProcedureCodes(taskCode: string): string[] {
  return (
    db
      .prepare('SELECT procedure_code FROM task_procedures WHERE task_code = ? ORDER BY position')
      .all(taskCode) as Row[]
  ).map((r) => r.procedure_code as string)
}

function setTaskProcedures(taskCode: string, codes: string[]): void {
  const unique = [...new Set(codes)]
  const missing = unique.filter((c) => !getProcedure(c))
  if (missing.length > 0) throw new Error(`Unknown procedures: ${missing.join(', ')}`)
  db.prepare('DELETE FROM task_procedures WHERE task_code = ?').run(taskCode)
  const insert = db.prepare(
    'INSERT INTO task_procedures (task_code, procedure_code, position) VALUES (?, ?, ?)'
  )
  unique.forEach((code, i) => insert.run(taskCode, code, i))
}

export function listTasks(projectId?: number): Task[] {
  const rows =
    projectId === undefined
      ? db.prepare('SELECT * FROM tasks ORDER BY created_at DESC, code DESC').all()
      : db
          .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC, code DESC')
          .all(projectId)
  return (rows as Row[]).map(toTask)
}

export function getTask(code: string): Task | null {
  const r = db.prepare('SELECT * FROM tasks WHERE code = ?').get(code) as Row | undefined
  return r ? toTask(r) : null
}

export function createTask(input: NewTask): Task {
  const task = transaction(() => {
    const code = nextCode('task', TASK_PREFIX)
    db.prepare(
      'INSERT INTO tasks (code, project_id, title, prompt, agent) VALUES (?, ?, ?, ?, ?)'
    ).run(code, input.projectId, input.title, input.prompt, input.agent)
    setTaskProcedures(code, input.procedures)
    return getTask(code)!
  })
  bus.emit('task', task)
  return task
}

const COLUMN_MAP: Record<string, string> = {
  title: 'title',
  prompt: 'prompt',
  agent: 'agent',
  status: 'status',
  summary: 'summary',
  question: 'question',
  answer: 'answer',
  sessionId: 'session_id',
  commitHash: 'commit_hash'
}

export type TaskPatch = TaskUpdate &
  Partial<Pick<Task, 'status' | 'summary' | 'question' | 'answer' | 'sessionId' | 'commitHash'>>

export function patchTask(code: string, patch: TaskPatch): Task {
  const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && k in COLUMN_MAP)
  const task = transaction(() => {
    if (entries.length > 0) {
      const sets = entries.map(([k]) => `${COLUMN_MAP[k]} = ?`).join(', ')
      db.prepare(`UPDATE tasks SET ${sets}, updated_at = datetime('now') WHERE code = ?`).run(
        ...entries.map(([, v]) => v as string | null),
        code
      )
    }
    if (patch.procedures) setTaskProcedures(code, patch.procedures)
    return getTask(code)
  })
  if (!task) throw new Error(`Task ${code} not found`)
  bus.emit('task', task)
  return task
}

/** Oldest Pending tasks first; the queue picks from here. */
export function listPendingTasks(): Task[] {
  return (
    db.prepare("SELECT * FROM tasks WHERE status = 'Pending' ORDER BY updated_at, code").all() as Row[]
  ).map(toTask)
}

// ---- Procedures ----

export function listProcedures(): Procedure[] {
  return (db.prepare('SELECT * FROM procedures ORDER BY code').all() as Row[]).map(toProcedure)
}

export function getProcedure(code: string): Procedure | null {
  const r = db.prepare('SELECT * FROM procedures WHERE code = ?').get(code) as Row | undefined
  return r ? toProcedure(r) : null
}

export function createProcedure(input: ProcedureInput): Procedure {
  return transaction(() => {
    const code = nextCode('procedure', PROCEDURE_PREFIX)
    const r = db
      .prepare('INSERT INTO procedures (code, title, prompt) VALUES (?, ?, ?) RETURNING *')
      .get(code, input.title, input.prompt) as Row
    return toProcedure(r)
  })
}

export function updateProcedure(code: string, input: ProcedureInput): Procedure {
  const r = db
    .prepare(
      `UPDATE procedures SET title = ?, prompt = ?, updated_at = datetime('now')
       WHERE code = ? RETURNING *`
    )
    .get(input.title, input.prompt, code) as Row | undefined
  if (!r) throw new Error(`Procedure ${code} not found`)
  return toProcedure(r)
}

/** Procedures referenced by any task cannot be deleted, so task history stays meaningful. */
export function deleteProcedure(code: string): void {
  const users = (
    db
      .prepare('SELECT task_code FROM task_procedures WHERE procedure_code = ? ORDER BY task_code')
      .all(code) as Row[]
  ).map((r) => r.task_code as string)
  if (users.length > 0) {
    throw new Error(`${code} está referenciado por: ${users.join(', ')}`)
  }
  db.prepare('DELETE FROM procedures WHERE code = ?').run(code)
}

// ---- Events ----

export function addEvent(taskCode: string, kind: TaskEventKind, content: string): TaskEvent {
  const r = db
    .prepare('INSERT INTO task_events (task_code, kind, content) VALUES (?, ?, ?) RETURNING *')
    .get(taskCode, kind, content) as Row
  const event = toEvent(r)
  bus.emit('event', event)
  return event
}

export function listEvents(taskCode: string): TaskEvent[] {
  return (
    db.prepare('SELECT * FROM task_events WHERE task_code = ? ORDER BY id').all(taskCode) as Row[]
  ).map(toEvent)
}
