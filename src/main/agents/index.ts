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

async function find(executable: string, env?: NodeJS.ProcessEnv): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(finder, [executable], { env })
    const candidates = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    // On Windows prefer real executables, then npm shims, over extensionless scripts.
    return (
      candidates.find((c) => /\.exe$/i.test(c)) ??
      candidates.find((c) => /\.cmd$/i.test(c)) ??
      candidates[0] ??
      null
    )
  } catch {
    return null
  }
}

/**
 * Current machine + user PATH from the registry. The app inherits PATH from whatever launched it,
 * so agents installed while it (or its terminal) was open would otherwise not be found.
 */
async function registryPath(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"
    ])
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function locate(executable: string): Promise<string | null> {
  const found = await find(executable)
  if (found || process.platform !== 'win32') return found
  const path = await registryPath()
  if (!path) return null
  // Windows env keys are case-insensitive: drop any existing Path/PATH before setting it.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'path'))
  return find(executable, { ...env, Path: path })
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
