import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ModelOption } from '@shared/types'

/** Best-effort discovery from the local Codex catalog; its format is not a public API. */
export async function loadCodexModels(
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
): Promise<ModelOption[]> {
  try {
    const catalog = JSON.parse(await readFile(join(codexHome, 'models_cache.json'), 'utf8'))
    if (!Array.isArray(catalog?.models)) return []

    const models = new Map<string, ModelOption>()
    for (const model of catalog.models) {
      if (model?.visibility !== 'list' || typeof model.slug !== 'string') continue
      const id = model.slug.trim()
      if (!id || models.has(id)) continue
      const label = typeof model.display_name === 'string' ? model.display_name.trim() : ''
      models.set(id, { id, label: label || id })
    }
    return [...models.values()]
  } catch {
    // A missing, unreadable or changing cache must not prevent task creation.
    // The picker still offers the agent default and manual model entry.
    return []
  }
}
