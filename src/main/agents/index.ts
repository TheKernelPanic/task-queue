import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentId, AgentInfo } from '@shared/types'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import type { AgentAdapter } from './types'

const execFileAsync = promisify(execFile)

export const adapters: Record<AgentId, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter
}

const resolved = new Map<AgentId, string | null>()

async function locate(executable: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(finder, [executable])
    const candidates = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    // On Windows prefer real executables / npm shims over extensionless scripts.
    return (
      candidates.find((c) => /\.(exe|cmd)$/i.test(c)) ?? candidates[0] ?? null
    )
  } catch {
    return null
  }
}

export async function detectAgents(): Promise<AgentInfo[]> {
  return Promise.all(
    Object.values(adapters).map(async (a) => {
      const path = await locate(a.executable)
      resolved.set(a.id, path)
      return { id: a.id, name: a.name, path, installed: path !== null, models: a.models }
    })
  )
}

export async function resolveAgentPath(id: AgentId): Promise<string | null> {
  if (!resolved.has(id)) await detectAgents()
  return resolved.get(id) ?? null
}
