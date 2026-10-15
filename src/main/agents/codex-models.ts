import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ModelOption, ReasoningLevel } from '@shared/types'

const defaultCodexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex')

function reasoningLevels(value: unknown): ReasoningLevel[] {
  if (!Array.isArray(value)) return []
  const levels = new Map<string, ReasoningLevel>()
  for (const level of value) {
    const effort = typeof level?.effort === 'string' ? level.effort.trim() : ''
    if (!effort || levels.has(effort)) continue
    const description = typeof level.description === 'string' ? level.description.trim() : ''
    levels.set(effort, { effort, description })
  }
  return [...levels.values()]
}

/** Best-effort discovery from the local Codex catalog; its format is not a public API. */
export async function loadCodexModels(codexHome = defaultCodexHome()): Promise<ModelOption[]> {
  try {
    const catalog = JSON.parse(await readFile(join(codexHome, 'models_cache.json'), 'utf8'))
    if (!Array.isArray(catalog?.models)) return []

    const models = new Map<string, ModelOption>()
    for (const model of catalog.models) {
      if (model?.visibility !== 'list' || typeof model.slug !== 'string') continue
      const id = model.slug.trim()
      if (!id || models.has(id)) continue
      const label = typeof model.display_name === 'string' ? model.display_name.trim() : ''
      const option: ModelOption = { id, label: label || id }
      const levels = reasoningLevels(model.supported_reasoning_levels)
      if (levels.length > 0) {
        option.reasoningLevels = levels
        const fallback = model.default_reasoning_level
        if (typeof fallback === 'string' && levels.some((l) => l.effort === fallback)) {
          option.defaultReasoning = fallback
        }
      }
      models.set(id, option)
    }
    return [...models.values()]
  } catch {
    // A missing, unreadable or changing cache must not prevent task creation.
    // The picker still offers the agent default and manual model entry.
    return []
  }
}

export interface CodexDefaults {
  model: string | null
  reasoningEffort: string | null
}

/**
 * Top-level `model` and `model_reasoning_effort` of the user's config.toml, which Codex uses
 * when a task sets none. Only simple `key = "value"` lines before the first table are read.
 */
export async function loadCodexDefaults(codexHome = defaultCodexHome()): Promise<CodexDefaults> {
  const defaults: CodexDefaults = { model: null, reasoningEffort: null }
  let config: string
  try {
    config = await readFile(join(codexHome, 'config.toml'), 'utf8')
  } catch {
    return defaults
  }
  for (const line of config.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break
    const match = /^\s*([A-Za-z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line)
    const value = (match?.[2] ?? match?.[3])?.trim()
    if (!value) continue
    if (match![1] === 'model') defaults.model = value
    if (match![1] === 'model_reasoning_effort') defaults.reasoningEffort = value
  }
  return defaults
}
