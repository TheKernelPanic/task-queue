import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadCodexModels } from '../src/main/agents/codex-models.ts'

test('loads visible models, preserves catalog order and ignores invalid or duplicate entries', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'taskqueue-models-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await writeFile(join(home, 'models_cache.json'), JSON.stringify({ models: [
    { slug: 'model-b', display_name: 'Model B', visibility: 'list' },
    { slug: 'internal', visibility: 'hide' },
    { slug: 'model-a', visibility: 'list' },
    { slug: 'model-b', display_name: 'Duplicate', visibility: 'list' },
    { slug: ' ', visibility: 'list' },
    { slug: 42, visibility: 'list' },
    null
  ] }))
  assert.deepEqual(await loadCodexModels(home), [
    { id: 'model-b', label: 'Model B' },
    { id: 'model-a', label: 'model-a' }
  ])
})

test('missing, malformed and incompatible catalogs safely fall back to manual selection', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'taskqueue-models-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  assert.deepEqual(await loadCodexModels(home), [])
  for (const content of ['{', 'null', '{}', '{"models":{}}']) {
    await writeFile(join(home, 'models_cache.json'), content)
    assert.deepEqual(await loadCodexModels(home), [])
  }
})
