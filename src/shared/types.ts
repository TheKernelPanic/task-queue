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

/** Name used in commit messages made by each agent. */
export const AGENT_COMMIT_LABELS: Record<AgentId, string> = {
  claude: 'Claude',
  codex: 'Codex'
}

export type PermissionMode = 'acceptEdits' | 'bypassPermissions'

export interface ModelOption {
  /** Value passed to the agent CLI (alias or full model name). */
  id: string
  label: string
}

export interface AgentInfo {
  id: AgentId
  name: string
  path: string | null
  installed: boolean
  /** Suggested models; any other model name can be typed in. */
  models: ModelOption[]
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
  /** Model for the agent; null uses the agent's default. */
  model: string | null
  /** Whether the agent must commit its changes (message: commitMessage(task)). */
  commit: boolean
  status: TaskStatus
  summary: string | null
  question: string | null
  answer: string | null
  sessionId: string | null
  commitHash: string | null
  /** Codes of the procedures the agent must follow, in order. */
  procedures: string[]
  /** Copies of the linked procedures taken when the task was first queued (empty until then). */
  procedureSnapshots: ProcedureSnapshot[]
  /** Codes of previously completed (Done) tasks of the same project this task builds on. */
  dependencies: string[]
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

/** A procedure frozen into a task when it is queued; the agent follows this version. */
export interface ProcedureSnapshot {
  code: string
  title: string
  prompt: string
  snapshotAt: string
}

export interface ProcedureInput {
  title: string
  prompt: string
  projectIds: number[]
}

export type TaskFolderKind = 'resources' | 'outputs' | 'answers' | 'workspace'

/** A file in one of a task's internal folders. */
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
  model: string | null
  commit: boolean
  procedures: string[]
  dependencies: string[]
}

export interface TaskUpdate {
  title?: string
  prompt?: string
  agent?: AgentId
  model?: string | null
  commit?: boolean
  procedures?: string[]
  dependencies?: string[]
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

/** Exact commit message the agent must use, e.g. "Claude: DK-0012". */
export function commitMessage(task: Pick<Task, 'agent' | 'code'>): string {
  return `${AGENT_COMMIT_LABELS[task.agent]}: ${task.code}`
}

/** A task (definition, procedures and resources) can only be modified until it is queued. */
export function isTaskEditable(task: Pick<Task, 'status'>): boolean {
  return task.status === 'Created'
}

/** Only cancelled tasks can be deleted. */
export function isTaskDeletable(task: Pick<Task, 'status'>): boolean {
  return task.status === 'Cancelled'
}

export const TASK_LOCKED_MESSAGE = 'La tarea ya se ha encolado y no puede modificarse'

export interface UpdateInfo {
  version: string
  releasedAt: string
}

export interface AppInfo {
  version: string
  /** False when running from source (npm run dev / start): updates are disabled. */
  packaged: boolean
  dataDir: string
  releasesDir: string
}

export interface TaskQueueApi {
  getAppInfo(): Promise<AppInfo>
  checkForUpdate(): Promise<UpdateInfo | null>
  /** Runs the new installer silently; the app closes and reopens updated. */
  installUpdate(): Promise<void>
  onUpdateAvailable(cb: (info: UpdateInfo) => void): () => void
  listAgents(): Promise<AgentInfo[]>
  listProjects(): Promise<Project[]>
  createProject(input: NewProject): Promise<Project>
  deleteProject(id: number): Promise<void>
  listTasks(projectId?: number): Promise<Task[]>
  getTask(code: string): Promise<Task | null>
  createTask(input: NewTask): Promise<Task>
  updateTask(code: string, patch: TaskUpdate): Promise<Task>
  setTaskStatus(code: string, status: TaskStatus): Promise<Task>
  /** Deletes a Cancelled task with its history, runs and internal folders. */
  deleteTask(code: string): Promise<void>
  /** Answers the agent's question; `paths` are files to attach (copied to the task's answers folder). */
  answerQuestion(code: string, answer: string, paths: string[]): Promise<Task>
  listProcedures(): Promise<Procedure[]>
  createProcedure(input: ProcedureInput): Promise<Procedure>
  updateProcedure(code: string, input: ProcedureInput): Promise<Procedure>
  deleteProcedure(code: string): Promise<void>
  listResources(code: string): Promise<TaskFile[]>
  addResources(code: string, paths: string[]): Promise<TaskFile[]>
  removeResource(code: string, name: string): Promise<TaskFile[]>
  listOutputs(code: string): Promise<TaskFile[]>
  listAnswerFiles(code: string): Promise<TaskFile[]>
  /** Files in the task's working directory; capped, `truncated` tells if there were more. */
  listWorkspace(code: string): Promise<{ files: TaskFile[]; truncated: boolean }>
  /** Opens one of the task's internal folders in the OS file explorer (creating it if needed). */
  openTaskFolder(code: string, kind: TaskFolderKind): Promise<void>
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
  onTaskDeleted(cb: (code: string) => void): () => void
  onTaskEvent(cb: (event: TaskEvent) => void): () => void
  /** Fired once when a task transitions to Done. */
  onTaskDone(cb: (task: Task) => void): () => void
}
