import { DatabaseSync } from 'node:sqlite'
import { EventEmitter } from 'node:events'
import type {
  NewProject,
  NewTask,
  Procedure,
  ProcedureInput,
  ProcedureSnapshot,
  Project,
  RunStatus,
  Task,
  TaskEvent,
  TaskEventKind,
  TaskRun,
  TaskStatus,
  TaskUpdate
} from '@shared/types'

const TASK_PREFIX = 'DK'
const PROCEDURE_PREFIX = 'PR'

/**
 * Emits 'task' (Task), 'event' (TaskEvent) and 'run' (TaskRun) whenever data changes,
 * 'done' (Task) when a task transitions to Done and 'deleted' (task code) when a task is removed.
 */
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

    CREATE TABLE IF NOT EXISTS procedure_projects (
      procedure_code TEXT NOT NULL REFERENCES procedures(code) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (procedure_code, project_id)
    );

    CREATE TABLE IF NOT EXISTS task_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_code TEXT NOT NULL REFERENCES tasks(code) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      duration_ms INTEGER,
      api_duration_ms INTEGER,
      turns INTEGER,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      models TEXT NOT NULL DEFAULT '[]',
      rate_limit TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_code, id);

    CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_code, id);
  `)

  // Columns added after the first release.
  addColumn('task_procedures', 'snapshot_title', 'TEXT')
  addColumn('task_procedures', 'snapshot_prompt', 'TEXT')
  addColumn('task_procedures', 'snapshot_at', 'TEXT')
  addColumn('tasks', 'model', 'TEXT')
  addColumn('tasks', 'auto_commit', 'INTEGER NOT NULL DEFAULT 1')
}

function addColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
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
    model: (r.model as string) ?? null,
    commit: r.auto_commit === 1,
    status: r.status as TaskStatus,
    summary: (r.summary as string) ?? null,
    question: (r.question as string) ?? null,
    answer: (r.answer as string) ?? null,
    sessionId: (r.session_id as string) ?? null,
    commitHash: (r.commit_hash as string) ?? null,
    procedures: taskProcedureCodes(r.code as string),
    procedureSnapshots: taskProcedureSnapshots(r.code as string),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  }
}

function toProcedure(r: Row): Procedure {
  return {
    code: r.code as string,
    title: r.title as string,
    prompt: r.prompt as string,
    projectIds: procedureProjectIds(r.code as string),
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

function taskProcedureSnapshots(taskCode: string): ProcedureSnapshot[] {
  return (
    db
      .prepare(
        `SELECT procedure_code, snapshot_title, snapshot_prompt, snapshot_at FROM task_procedures
         WHERE task_code = ? AND snapshot_at IS NOT NULL ORDER BY position`
      )
      .all(taskCode) as Row[]
  ).map((r) => ({
    code: r.procedure_code as string,
    title: r.snapshot_title as string,
    prompt: r.snapshot_prompt as string,
    snapshotAt: r.snapshot_at as string
  }))
}

/** Freezes the current version of every linked procedure that has no copy yet. */
export function snapshotTaskProcedures(taskCode: string): void {
  db.prepare(
    `UPDATE task_procedures SET
       snapshot_title = (SELECT title FROM procedures WHERE code = procedure_code),
       snapshot_prompt = (SELECT prompt FROM procedures WHERE code = procedure_code),
       snapshot_at = datetime('now')
     WHERE task_code = ? AND snapshot_at IS NULL`
  ).run(taskCode)
}

function taskProcedureCodes(taskCode: string): string[] {
  return (
    db
      .prepare('SELECT procedure_code FROM task_procedures WHERE task_code = ? ORDER BY position')
      .all(taskCode) as Row[]
  ).map((r) => r.procedure_code as string)
}

function setTaskProcedures(taskCode: string, projectId: number, codes: string[]): void {
  const unique = [...new Set(codes)]
  const missing = unique.filter((c) => !getProcedure(c))
  if (missing.length > 0) throw new Error(`Unknown procedures: ${missing.join(', ')}`)
  const foreign = unique.filter((c) => !getProcedure(c)!.projectIds.includes(projectId))
  if (foreign.length > 0) {
    throw new Error(`Procedimientos que no pertenecen al proyecto de la tarea: ${foreign.join(', ')}`)
  }
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
      `INSERT INTO tasks (code, project_id, title, prompt, agent, model, auto_commit)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      code,
      input.projectId,
      input.title,
      input.prompt,
      input.agent,
      input.model?.trim() || null,
      input.commit ? 1 : 0
    )
    setTaskProcedures(code, input.projectId, input.procedures)
    return getTask(code)!
  })
  bus.emit('task', task)
  return task
}

const COLUMN_MAP: Record<string, string> = {
  title: 'title',
  prompt: 'prompt',
  agent: 'agent',
  model: 'model',
  commit: 'auto_commit',
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
  const previousStatus = patch.status ? getTask(code)?.status : undefined
  const task = transaction(() => {
    if (entries.length > 0) {
      const sets = entries.map(([k]) => `${COLUMN_MAP[k]} = ?`).join(', ')
      db.prepare(`UPDATE tasks SET ${sets}, updated_at = datetime('now') WHERE code = ?`).run(
        ...entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | null))),
        code
      )
    }
    const current = getTask(code)
    if (current && patch.procedures) {
      setTaskProcedures(code, current.projectId, patch.procedures)
      return getTask(code)
    }
    return current
  })
  if (!task) throw new Error(`Task ${code} not found`)
  bus.emit('task', task)
  if (task.status === 'Done' && previousStatus !== undefined && previousStatus !== 'Done') {
    bus.emit('done', task)
  }
  return task
}

/** Removes a task; events, runs and procedure links go with it (ON DELETE CASCADE). */
export function deleteTask(code: string): void {
  db.prepare('DELETE FROM tasks WHERE code = ?').run(code)
  bus.emit('deleted', code)
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

function procedureProjectIds(code: string): number[] {
  return (
    db
      .prepare('SELECT project_id FROM procedure_projects WHERE procedure_code = ? ORDER BY project_id')
      .all(code) as Row[]
  ).map((r) => r.project_id as number)
}

/**
 * Replaces the projects a procedure belongs to. A project cannot be removed while
 * tasks of that project still reference the procedure.
 */
function setProcedureProjects(code: string, projectIds: number[]): void {
  const unique = [...new Set(projectIds)]
  if (unique.length === 0) throw new Error('El procedimiento debe pertenecer al menos a un proyecto')
  const missing = unique.filter((id) => !getProject(id))
  if (missing.length > 0) throw new Error(`Unknown projects: ${missing.join(', ')}`)

  const removed = procedureProjectIds(code).filter((id) => !unique.includes(id))
  if (removed.length > 0) {
    const placeholders = removed.map(() => '?').join(', ')
    const users = (
      db
        .prepare(
          `SELECT tp.task_code FROM task_procedures tp
           JOIN tasks t ON t.code = tp.task_code
           WHERE tp.procedure_code = ? AND t.project_id IN (${placeholders})
           ORDER BY tp.task_code`
        )
        .all(code, ...removed) as Row[]
    ).map((r) => r.task_code as string)
    if (users.length > 0) {
      throw new Error(
        `No se puede quitar el proyecto: ${code} está referenciado por ${users.join(', ')}`
      )
    }
  }

  db.prepare('DELETE FROM procedure_projects WHERE procedure_code = ?').run(code)
  const insert = db.prepare(
    'INSERT INTO procedure_projects (procedure_code, project_id) VALUES (?, ?)'
  )
  for (const id of unique) insert.run(code, id)
}

export function createProcedure(input: ProcedureInput): Procedure {
  return transaction(() => {
    const code = nextCode('procedure', PROCEDURE_PREFIX)
    db.prepare('INSERT INTO procedures (code, title, prompt) VALUES (?, ?, ?)').run(
      code,
      input.title,
      input.prompt
    )
    setProcedureProjects(code, input.projectIds)
    return getProcedure(code)!
  })
}

export function updateProcedure(code: string, input: ProcedureInput): Procedure {
  return transaction(() => {
    const result = db
      .prepare(
        `UPDATE procedures SET title = ?, prompt = ?, updated_at = datetime('now') WHERE code = ?`
      )
      .run(input.title, input.prompt, code)
    if (result.changes === 0) throw new Error(`Procedure ${code} not found`)
    setProcedureProjects(code, input.projectIds)
    return getProcedure(code)!
  })
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

// ---- Runs ----

function toRun(r: Row): TaskRun {
  return {
    id: r.id as number,
    taskCode: r.task_code as string,
    agent: r.agent as TaskRun['agent'],
    sessionId: (r.session_id as string) ?? null,
    status: r.status as RunStatus,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string) ?? null,
    durationMs: (r.duration_ms as number) ?? null,
    apiDurationMs: (r.api_duration_ms as number) ?? null,
    turns: (r.turns as number) ?? null,
    inputTokens: r.input_tokens as number,
    outputTokens: r.output_tokens as number,
    cacheReadTokens: r.cache_read_tokens as number,
    cacheCreationTokens: r.cache_creation_tokens as number,
    costUsd: (r.cost_usd as number) ?? null,
    models: JSON.parse(r.models as string),
    rateLimit: r.rate_limit ? JSON.parse(r.rate_limit as string) : null
  }
}

export function getRun(id: number): TaskRun | null {
  const r = db.prepare('SELECT * FROM task_runs WHERE id = ?').get(id) as Row | undefined
  return r ? toRun(r) : null
}

export function listRuns(taskCode: string): TaskRun[] {
  return (
    db.prepare('SELECT * FROM task_runs WHERE task_code = ? ORDER BY id').all(taskCode) as Row[]
  ).map(toRun)
}

export function startRun(taskCode: string, agent: TaskRun['agent']): TaskRun {
  const r = db
    .prepare('INSERT INTO task_runs (task_code, agent) VALUES (?, ?) RETURNING *')
    .get(taskCode, agent) as Row
  const run = toRun(r)
  bus.emit('run', run)
  return run
}

const RUN_COLUMNS: Record<string, string> = {
  sessionId: 'session_id',
  status: 'status',
  durationMs: 'duration_ms',
  apiDurationMs: 'api_duration_ms',
  turns: 'turns',
  inputTokens: 'input_tokens',
  outputTokens: 'output_tokens',
  cacheReadTokens: 'cache_read_tokens',
  cacheCreationTokens: 'cache_creation_tokens',
  costUsd: 'cost_usd',
  models: 'models',
  rateLimit: 'rate_limit'
}

export type RunPatch = Partial<Omit<TaskRun, 'id' | 'taskCode' | 'agent' | 'startedAt'>>

export function patchRun(id: number, patch: RunPatch, finished = false): TaskRun {
  const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && k in RUN_COLUMNS)
  const sets = entries.map(([k]) => `${RUN_COLUMNS[k]} = ?`)
  if (finished) sets.push(`finished_at = datetime('now')`)
  if (sets.length > 0) {
    db.prepare(`UPDATE task_runs SET ${sets.join(', ')} WHERE id = ?`).run(
      ...entries.map(([, v]) =>
        v !== null && typeof v === 'object' ? JSON.stringify(v) : (v as string | number | null)
      ),
      id
    )
  }
  const run = getRun(id)
  if (!run) throw new Error(`Run ${id} not found`)
  bus.emit('run', run)
  return run
}

/** Runs left 'running' by a previous app session can't be reattached. */
export function interruptRunningRuns(): void {
  db.prepare(
    `UPDATE task_runs SET status = 'interrupted', finished_at = datetime('now') WHERE status = 'running'`
  ).run()
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
