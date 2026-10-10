export const TASK_STATUSES = [
  'Created',
  'Pending',
  'InProgress',
  'WaitingForInput',
  'Stopped',
  'Done',
  'Cancelled'
] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export type AgentId = 'claude' | 'codex'

export type PermissionMode = 'acceptEdits' | 'bypassPermissions'

export interface AgentInfo {
  id: AgentId
  name: string
  path: string | null
  installed: boolean
}

export interface Project {
  id: number
  name: string
  path: string
  isGitRepo: boolean
  permissionMode: PermissionMode
  createdAt: string
}

export interface Task {
  code: string
  projectId: number
  title: string
  prompt: string
  agent: AgentId
  status: TaskStatus
  summary: string | null
  question: string | null
  answer: string | null
  sessionId: string | null
  commitHash: string | null
  /** Codes of the procedures the agent must follow, in order. */
  procedures: string[]
  createdAt: string
  updatedAt: string
}

export interface Procedure {
  code: string
  title: string
  prompt: string
  /** Projects the procedure belongs to; tasks can only link procedures of their own project. */
  projectIds: number[]
  createdAt: string
  updatedAt: string
}

export interface ProcedureInput {
  title: string
  prompt: string
  projectIds: number[]
}

/** A file in a task's internal resources or outputs folder. */
export interface TaskFile {
  /** Path relative to the task folder, with forward slashes. */
  name: string
  /** Absolute path on disk. */
  path: string
  size: number
  modifiedAt: string
}

/** Token and cost consumption, per model or aggregated. */
export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** API list-price estimate reported by the agent; null when the agent doesn't report it. */
  costUsd: number | null
}

export interface ModelUsage extends UsageTotals {
  model: string
}

export interface RateLimitWindow {
  /** 0..1 */
  utilization: number
  resetsAt: string | null
}

/** Account plan quota as reported by the agent (account-wide, not per task). */
export interface RateLimitSnapshot {
  status: string
  windows: Record<string, RateLimitWindow>
  capturedAt: string
}

export type RunStatus = 'running' | 'success' | 'error' | 'cancelled' | 'interrupted'

/** One agent process execution for a task (a resumed task has several runs). */
export interface TaskRun extends UsageTotals {
  id: number
  taskCode: string
  agent: AgentId
  sessionId: string | null
  status: RunStatus
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  apiDurationMs: number | null
  turns: number | null
  models: ModelUsage[]
  rateLimit: RateLimitSnapshot | null
}

export type TaskEventKind = 'text' | 'thinking' | 'command' | 'output' | 'system' | 'error'

export interface TaskEvent {
  id: number
  taskCode: string
  kind: TaskEventKind
  content: string
  createdAt: string
}

export interface NewProject {
  name: string
  path: string
  permissionMode?: PermissionMode
}

export interface NewTask {
  projectId: number
  title: string
  prompt: string
  agent: AgentId
  procedures: string[]
}

export interface TaskUpdate {
  title?: string
  prompt?: string
  agent?: AgentId
  procedures?: string[]
}

export interface CommitInfo {
  hash: string
  message: string
  author: string
  date: string
  files: { path: string; diff: string }[]
}

/**
 * Allowed manual transitions from the UI. Agent-driven transitions go through MCP.
 * There is no way back to Created: once queued, a task is never Created again.
 */
export const MANUAL_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  Created: ['Pending', 'Cancelled'],
  Pending: ['Cancelled'],
  InProgress: ['Stopped', 'Cancelled'],
  WaitingForInput: ['Stopped', 'Cancelled'],
  Stopped: ['Pending', 'Cancelled'],
  Done: [],
  Cancelled: []
}

/** A task (definition, procedures and resources) can only be modified until it is queued. */
export function isTaskEditable(task: Pick<Task, 'status'>): boolean {
  return task.status === 'Created'
}

export const TASK_LOCKED_MESSAGE = 'La tarea ya se ha encolado y no puede modificarse'

export interface TaskQueueApi {
  listAgents(): Promise<AgentInfo[]>
  listProjects(): Promise<Project[]>
  createProject(input: NewProject): Promise<Project>
  deleteProject(id: number): Promise<void>
  listTasks(projectId?: number): Promise<Task[]>
  getTask(code: string): Promise<Task | null>
  createTask(input: NewTask): Promise<Task>
  updateTask(code: string, patch: TaskUpdate): Promise<Task>
  setTaskStatus(code: string, status: TaskStatus): Promise<Task>
  answerQuestion(code: string, answer: string): Promise<Task>
  listProcedures(): Promise<Procedure[]>
  createProcedure(input: ProcedureInput): Promise<Procedure>
  updateProcedure(code: string, input: ProcedureInput): Promise<Procedure>
  deleteProcedure(code: string): Promise<void>
  listResources(code: string): Promise<TaskFile[]>
  addResources(code: string, paths: string[]): Promise<TaskFile[]>
  removeResource(code: string, name: string): Promise<TaskFile[]>
  listOutputs(code: string): Promise<TaskFile[]>
  /** Opens a file or folder of the internal storage with the OS default app. */
  openPath(path: string): Promise<void>
  /** Shows a file of the internal storage in the OS file explorer. */
  showInFolder(path: string): Promise<void>
  /** Absolute path of a File dropped from the OS (Electron webUtils). */
  getPathForFile(file: File): string
  listRuns(code: string): Promise<TaskRun[]>
  onTaskRun(cb: (run: TaskRun) => void): () => void
  listEvents(code: string): Promise<TaskEvent[]>
  getCommit(code: string): Promise<CommitInfo | null>
  pickPath(kind: 'file' | 'directory'): Promise<string | null>
  onTaskChanged(cb: (task: Task) => void): () => void
  onTaskEvent(cb: (event: TaskEvent) => void): () => void
}
