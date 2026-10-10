import { MCP_SERVER_NAME } from '../mcp'
import { systemInstructions, truncate, type AgentAdapter, type ParsedEvent } from './types'

/**
 * Codex CLI adapter (`codex exec --json`).
 * Not yet verified against a real install; event shapes follow the documented JSONL format.
 */
export const codexAdapter: AgentAdapter = {
  id: 'codex',
  name: 'Codex',
  executable: 'codex',

  buildArgs({ task, project, mcp, prompt, resumeSessionId, resourcesDir, outputsDir }) {
    const server = `mcp_servers.${MCP_SERVER_NAME}`
    const args = [
      'exec',
      ...(resumeSessionId ? ['resume', resumeSessionId] : []),
      '--json',
      '-c',
      `${server}.url="${mcp.url}"`,
      '-c',
      `${server}.http_headers={ Authorization = "Bearer ${mcp.token}" }`,
      '--add-dir',
      resourcesDir,
      '--add-dir',
      outputsDir,
      ...(project.permissionMode === 'bypassPermissions'
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : ['--full-auto']),
      // Codex has no system-prompt flag in exec mode, so instructions travel with the prompt.
      `${systemInstructions(task.code)}\n\n${prompt}`
    ]
    return args
  },

  parseLine(line) {
    const msg = JSON.parse(line) as Record<string, unknown>
    const events: ParsedEvent[] = []

    if (msg.type === 'thread.started') {
      return { events, sessionId: msg.thread_id as string }
    }

    if (msg.type === 'item.completed') {
      const item = msg.item as Record<string, unknown>
      switch (item?.type) {
        case 'agent_message':
          events.push({ kind: 'text', content: item.text as string })
          return { events, result: item.text as string }
        case 'reasoning':
          events.push({ kind: 'thinking', content: item.text as string })
          break
        case 'command_execution':
          events.push({ kind: 'command', content: `$ ${item.command as string}` })
          if (typeof item.aggregated_output === 'string' && item.aggregated_output.trim()) {
            events.push({
              kind: item.exit_code === 0 ? 'output' : 'error',
              content: truncate(item.aggregated_output)
            })
          }
          break
        case 'file_change':
          events.push({ kind: 'command', content: `edit ${JSON.stringify(item.changes)}` })
          break
        case 'mcp_tool_call':
          events.push({ kind: 'command', content: `${item.server as string}.${item.tool as string}` })
          break
      }
    } else if (msg.type === 'turn.completed') {
      // Codex reports tokens per turn (input includes cached tokens) but no cost nor model.
      const u = (msg.usage ?? {}) as Record<string, number>
      const cached = u.cached_input_tokens ?? 0
      const totals = {
        inputTokens: (u.input_tokens ?? 0) - cached,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: cached,
        cacheCreationTokens: 0,
        costUsd: null
      }
      return { events, usage: { ...totals, models: [{ model: 'codex', ...totals }], turns: 1 } }
    } else if (msg.type === 'turn.failed' || msg.type === 'error') {
      events.push({ kind: 'error', content: JSON.stringify(msg.error ?? msg) })
    }

    return { events }
  }
}
