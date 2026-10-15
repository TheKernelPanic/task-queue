import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadCodexDefaults, loadCodexModels } from '../src/main/agents/codex-models.ts'

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

test('reads reasoning levels and their default, skipping invalid or duplicate levels', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'taskqueue-models-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await writeFile(join(home, 'models_cache.json'), JSON.stringify({ models: [
    {
      slug: 'model-a',
      visibility: 'list',
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low', description: 'Fast' },
        { effort: 'medium' },
        { effort: 'low', description: 'Duplicate' },
        { effort: '' },
        null
      ]
    },
    { slug: 'model-b', visibility: 'list', default_reasoning_level: 'ultra', supported_reasoning_levels: [{ effort: 'high' }] }
  ] }))
  assert.deepEqual(await loadCodexModels(home), [
    {
      id: 'model-a',
      label: 'model-a',
      reasoningLevels: [{ effort: 'low', description: 'Fast' }, { effort: 'medium', description: '' }],
      defaultReasoning: 'medium'
    },
    { id: 'model-b', label: 'model-b', reasoningLevels: [{ effort: 'high', description: '' }] }
  ])
})

test('reads the default model and reasoning effort from the top level of config.toml', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'taskqueue-models-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  assert.deepEqual(await loadCodexDefaults(home), { model: null, reasoningEffort: null })
  await writeFile(
    join(home, 'config.toml'),
    'model = "model-a"\r\nmodel_reasoning_effort = \'high\'\n\n[profiles.fast]\nmodel = "model-b"\n'
  )
  assert.deepEqual(await loadCodexDefaults(home), { model: 'model-a', reasoningEffort: 'high' })
})
