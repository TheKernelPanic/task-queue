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
  createdAt: string
  updatedAt: string
}

export interface ProcedureInput {
  title: string
  prompt: string
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

/** Allowed manual transitions from the UI. Agent-driven transitions go through MCP. */
export const MANUAL_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  Created: ['Pending', 'Cancelled'],
  Pending: ['Created', 'Cancelled'],
  InProgress: ['Stopped', 'Cancelled'],
  WaitingForInput: ['Stopped', 'Cancelled'],
  Stopped: ['Pending', 'Cancelled'],
  Done: [],
  Cancelled: ['Created']
}

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
  listEvents(code: string): Promise<TaskEvent[]>
  getCommit(code: string): Promise<CommitInfo | null>
  pickPath(kind: 'file' | 'directory'): Promise<string | null>
  onTaskChanged(cb: (task: Task) => void): () => void
  onTaskEvent(cb: (event: TaskEvent) => void): () => void
}
