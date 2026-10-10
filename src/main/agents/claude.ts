import { MCP_SERVER_NAME } from '../mcp'
import type { RateLimitSnapshot } from '@shared/types'
import {
  systemInstructions,
  truncate,
  type AgentAdapter,
  type ParsedEvent,
  type UsageReport
} from './types'

type Block = Record<string, unknown> & { type: string }

function describeToolUse(block: Block): string {
  const name = block.name as string
  const input = (block.input ?? {}) as Record<string, unknown>
  if (name === 'Bash' && typeof input.command === 'string') return `$ ${input.command}`
  if (typeof input.file_path === 'string') return `${name} ${input.file_path}`
  return `${name} ${truncate(JSON.stringify(input), 500)}`
}

function toolResultText(block: Block): string {
  const content = block.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: Block) => (c.type === 'text' ? (c.text as string) : `[${c.type}]`))
      .join('\n')
  }
  return ''
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

function parseUsage(msg: Record<string, unknown>, isError: boolean): UsageReport {
  const usage = (msg.usage ?? {}) as Record<string, unknown>
  const modelUsage = (msg.modelUsage ?? {}) as Record<string, Record<string, unknown>>
  return {
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheCreationTokens: num(usage.cache_creation_input_tokens),
    costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
    models: Object.entries(modelUsage).map(([model, m]) => ({
      model,
      inputTokens: num(m.inputTokens),
      outputTokens: num(m.outputTokens),
      cacheReadTokens: num(m.cacheReadInputTokens),
      cacheCreationTokens: num(m.cacheCreationInputTokens),
      costUsd: typeof m.costUSD === 'number' ? m.costUSD : null
    })),
    durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : undefined,
    apiDurationMs: typeof msg.duration_api_ms === 'number' ? msg.duration_api_ms : undefined,
    turns: typeof msg.num_turns === 'number' ? msg.num_turns : undefined,
    isError,
    sessionCumulative: true
  }
}

const epochToIso = (v: unknown): string | null =>
  typeof v === 'number' ? new Date(v * 1000).toISOString() : null

function parseRateLimit(info: Record<string, unknown> | undefined): RateLimitSnapshot | undefined {
  if (!info) return undefined
  const windows: RateLimitSnapshot['windows'] = {}
  const unified = (info.unifiedWindows ?? {}) as Record<string, Record<string, unknown>>
  for (const [name, w] of Object.entries(unified)) {
    if (typeof w.utilization === 'number') {
      windows[name] = { utilization: w.utilization, resetsAt: epochToIso(w.resetsAt) }
    }
  }
  return {
    status: String(info.status ?? 'unknown'),
    windows,
    capturedAt: new Date().toISOString()
  }
}

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  name: 'Claude Code',
  executable: 'claude',
  // Aliases always point to the latest model of each family.
  models: [
    { id: 'fable', label: 'Fable (último)' },
    { id: 'opus', label: 'Opus (último)' },
    { id: 'sonnet', label: 'Sonnet (último)' },
    { id: 'haiku', label: 'Haiku (último)' },
    { id: 'claude-fable-5-1', label: 'claude-fable-5-1' },
    { id: 'claude-opus-5-5', label: 'claude-opus-5-5' },
    { id: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5' },
    { id: 'claude-haiku-5-5', label: 'claude-haiku-5-5' }
  ],

  buildArgs({
    task,
    project,
    mcp,
    prompt,
    resumeSessionId,
    resourcesDir,
    outputsDir,
    answersDir,
    workspaceDir
  }) {
    const mcpConfig = {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: mcp.url,
          headers: { Authorization: `Bearer ${mcp.token}` }
        }
      }
    }
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--mcp-config',
      JSON.stringify(mcpConfig),
      '--allowedTools',
      `mcp__${MCP_SERVER_NAME}`,
      '--permission-mode',
      project.permissionMode,
      '--append-system-prompt',
      systemInstructions(task.code),
      '--add-dir',
      resourcesDir,
      outputsDir,
      answersDir,
      workspaceDir
    ]
    if (task.model) args.push('--model', task.model)
    if (resumeSessionId) args.push('--resume', resumeSessionId)
    return args
  },

  parseLine(line) {
    const msg = JSON.parse(line) as Record<string, unknown>
    const events: ParsedEvent[] = []

    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          return { events, sessionId: msg.session_id as string }
        }
        return { events }

      case 'assistant': {
        const content = ((msg.message as Record<string, unknown>)?.content ?? []) as Block[]
        for (const block of content) {
          if (block.type === 'text' && (block.text as string).trim()) {
            events.push({ kind: 'text', content: block.text as string })
          } else if (block.type === 'thinking' && (block.thinking as string)?.trim()) {
            events.push({ kind: 'thinking', content: block.thinking as string })
          } else if (block.type === 'tool_use') {
            events.push({ kind: 'command', content: describeToolUse(block) })
          }
        }
        return { events }
      }

      case 'user': {
        const content = ((msg.message as Record<string, unknown>)?.content ?? []) as Block[]
        if (!Array.isArray(content)) return { events }
        for (const block of content) {
          if (block.type !== 'tool_result') continue
          const out = toolResultText(block)
          if (out.trim()) {
            events.push({ kind: block.is_error ? 'error' : 'output', content: truncate(out) })
          }
        }
        return { events }
      }

      case 'result': {
        const isError = msg.is_error === true || msg.subtype !== 'success'
        const cost = typeof msg.total_cost_usd === 'number' ? ` · $${msg.total_cost_usd.toFixed(4)}` : ''
        events.push({
          kind: isError ? 'error' : 'system',
          content: `Run finished (${msg.subtype})${cost}`
        })
        return {
          events,
          sessionId: msg.session_id as string | undefined,
          result: typeof msg.result === 'string' ? msg.result : undefined,
          usage: parseUsage(msg, isError)
        }
      }

      case 'rate_limit_event':
        return { events, rateLimit: parseRateLimit(msg.rate_limit_info as Record<string, unknown>) }

      default:
        return { events }
    }
  }
}
