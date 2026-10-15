import { MCP_SERVER_NAME } from '../mcp'
import { systemInstructions, truncate, type AgentAdapter, type ParsedEvent } from './types'

/** TOML literal string: no escaping, so Windows paths can go in as-is. */
const tomlLiteral = (value: string) => `'${value}'`

/**
 * Codex CLI adapter (`codex exec --json`), verified against codex-cli 0.162.
 *
 * `codex exec resume` does not accept `-s`/`--add-dir`, so sandbox mode and writable roots are
 * passed as `-c` config overrides, which both `exec` and `exec resume` understand.
 */
export const codexAdapter: AgentAdapter = {
  id: 'codex',
  name: 'Codex',
  executable: 'codex',
  // detectAgents loads suggestions from the local Codex model catalog.
  models: [],

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
    const server = `mcp_servers.${MCP_SERVER_NAME}`
    const sandbox =
      project.permissionMode === 'bypassPermissions'
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : [
            '-c',
            'sandbox_mode="workspace-write"',
            '-c',
            `sandbox_workspace_write.writable_roots=[${[resourcesDir, outputsDir, answersDir, workspaceDir]
              .map(tomlLiteral)
              .join(', ')}]`
          ]

    return [
      'exec',
      ...(resumeSessionId ? ['resume'] : []),
      '--json',
      '--skip-git-repo-check',
      ...(task.model ? ['-m', task.model] : []),
      ...(task.reasoningEffort ? ['-c', `model_reasoning_effort="${task.reasoningEffort}"`] : []),
      // Nobody can answer approval prompts in exec mode.
      '-c',
      'approval_policy="never"',
      ...sandbox,
      '-c',
      `${server}.url=${tomlLiteral(mcp.url)}`,
      '-c',
      `${server}.http_headers={ Authorization = ${tomlLiteral(`Bearer ${mcp.token}`)} }`,
      // MCP tool calls need approval by default, which `approval_policy=never` rejects.
      '-c',
      `${server}.default_tools_approval_mode="approve"`,
      ...(resumeSessionId ? [resumeSessionId] : []),
      // Codex has no system-prompt flag in exec mode, so instructions travel with the prompt.
      `${systemInstructions(task, project)}\n\n${prompt}`
    ]
  },

  cleanStderr(text) {
    // Printed on every run because stdin is not a TTY; not an error.
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim() !== 'Reading additional input from stdin...')
      .join('\n')
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
          if ((item.text as string)?.trim()) events.push({ kind: 'thinking', content: item.text as string })
          break
        case 'command_execution': {
          events.push({ kind: 'command', content: `$ ${item.command as string}` })
          const failed = item.status === 'failed' || (item.exit_code !== 0 && item.exit_code !== null)
          const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : ''
          if (output.trim() || failed) {
            events.push({
              kind: failed ? 'error' : 'output',
              content: truncate(output.trim() || `exit code ${item.exit_code}`)
            })
          }
          break
        }
        case 'file_change': {
          const changes = (item.changes ?? []) as { path: string; kind: string }[]
          for (const c of changes) events.push({ kind: 'command', content: `${c.kind} ${c.path}` })
          break
        }
        case 'mcp_tool_call':
          events.push({
            kind: 'command',
            content: `mcp__${item.server as string}__${item.tool as string} ${truncate(JSON.stringify(item.arguments ?? {}), 500)}`
          })
          if (item.status === 'failed' && item.error) {
            events.push({ kind: 'error', content: truncate(JSON.stringify(item.error)) })
          }
          break
        case 'error':
          // Non-fatal warnings (e.g. unrecognized settings in the user's config.toml).
          events.push({ kind: 'system', content: `Codex: ${item.message as string}` })
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
        cacheCreationTokens: u.cache_write_input_tokens ?? 0,
        costUsd: null
      }
      return { events, usage: { ...totals, models: [{ model: 'codex', ...totals }], turns: 1 } }
    } else if (msg.type === 'turn.failed' || msg.type === 'error') {
      const error = (msg.error ?? msg) as Record<string, unknown>
      events.push({ kind: 'error', content: String(error.message ?? JSON.stringify(error)) })
      return { events, usage: undefined }
    }

    return { events }
  }
}
