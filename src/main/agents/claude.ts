import { MCP_SERVER_NAME } from '../mcp'
import { systemInstructions, truncate, type AgentAdapter, type ParsedEvent } from './types'

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

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  name: 'Claude Code',
  executable: 'claude',

  buildArgs({ task, project, mcp, prompt, resumeSessionId }) {
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
      systemInstructions(task.code)
    ]
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
          result: typeof msg.result === 'string' ? msg.result : undefined
        }
      }

      default:
        return { events }
    }
  }
}
