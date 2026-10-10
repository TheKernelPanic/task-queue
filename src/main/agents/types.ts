import type {
  AgentId,
  ModelUsage,
  Project,
  RateLimitSnapshot,
  Task,
  TaskEventKind,
  UsageTotals
} from '@shared/types'
import type { McpEndpoint } from '../mcp'

export interface ParsedEvent {
  kind: TaskEventKind
  content: string
}

export interface ParsedLine {
  events: ParsedEvent[]
  sessionId?: string
  /** Final text produced by the agent, used as fallback summary. */
  result?: string
  /** Consumption reported by the agent; several reports in one run are added up. */
  usage?: UsageReport
  /** Latest account quota status. */
  rateLimit?: RateLimitSnapshot
}

export interface UsageReport extends UsageTotals {
  models: ModelUsage[]
  durationMs?: number
  apiDurationMs?: number
  turns?: number
  isError?: boolean
  /**
   * Cost, per-model usage and API duration are cumulative for the whole agent session
   * (Claude Code on --resume), so previous runs of the same session must be subtracted.
   */
  sessionCumulative?: boolean
}

export interface RunContext {
  task: Task
  project: Project
  mcp: McpEndpoint
  /** Prompt to send. On resume this carries the user's answer or a "continue" message. */
  prompt: string
  /** Agent session to resume, if any. */
  resumeSessionId: string | null
  /** Internal folders outside the project the agent must be able to read/write. */
  resourcesDir: string
  outputsDir: string
  answersDir: string
}

export interface AgentAdapter {
  id: AgentId
  name: string
  executable: string
  buildArgs(ctx: RunContext): string[]
  parseLine(line: string): ParsedLine
}

export const MAX_OUTPUT_CHARS = 20_000

export function truncate(value: string, max = MAX_OUTPUT_CHARS): string {
  return value.length > max ? `${value.slice(0, max)}\n… [truncated ${value.length - max} chars]` : value
}

export function systemInstructions(code: string): string {
  return [
    `You are executing task ${code} from TaskQueue.`,
    `1. Call the TaskQueue MCP tool get_task with code "${code}" to read the instructions.`,
    '2. get_task includes the procedures to follow, with their full instructions; follow them as part of the work.',
    `3. Call start_task with code "${code}" before doing any work.`,
    '4. Do the work in the current working directory. Use the files listed in "resources" (absolute paths) as inputs.',
    '   Files you generate that do not belong to the project (reports, exports, images…) go in "outputDir".',
    '5. If you need a decision from the user to continue, call ask_user and then stop immediately.',
    `6. When finished, call complete_task with code "${code}" and a Markdown summary of the work.`,
    'Do not run git commit yourself; TaskQueue commits the changes.'
  ].join('\n')
}
