import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { build } from 'esbuild'

test('migrates existing tasks and persists and validates task types', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'taskqueue-types-'))
  try {
    await build({ entryPoints: ['src/main/db.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'db.mjs') })
    await writeFile(join(dir, 'check.mjs'), `
      import assert from 'node:assert/strict'
      import { DatabaseSync } from 'node:sqlite'
      import * as db from './db.mjs'
      const file = process.argv[2]
      // A database from before task types existed.
      const legacy = new DatabaseSync(file)
      legacy.exec(\`
        CREATE TABLE tasks (
          code TEXT PRIMARY KEY, project_id INTEGER, title TEXT, prompt TEXT,
          agent TEXT, status TEXT, summary TEXT, question TEXT, answer TEXT,
          session_id TEXT, commit_hash TEXT, created_at TEXT, updated_at TEXT
        );
        INSERT INTO tasks (code, project_id, title, prompt, agent, status)
        VALUES ('OLD-1', 1, 'Existing task', 'Keep this prompt', 'codex', 'Done');
      \`)
      legacy.close()
      db.openDatabase(file)
      assert.equal(db.getTask('OLD-1').type, 'Feature')
      assert.equal(db.getTask('OLD-1').prompt, 'Keep this prompt')
      assert.equal(db.getTask('OLD-1').status, 'Done')
      const project = db.createProject({ name: 'Test', path: '/test' }, false)
      const input = { projectId: project.id, title: 'Task', prompt: 'Prompt', agent: 'codex', model: null, reasoningEffort: null, commit: false, procedures: [], dependencies: [], blockedBy: [] }
      const defaultTask = db.createTask(input)
      assert.equal(defaultTask.type, 'Feature')
      for (const type of ['Bug', 'Feature', 'Documentation', 'Planning', 'Analysis']) {
        const task = db.createTask({ ...input, type })
        assert.equal(db.getTask(task.code).type, type)
        assert.equal(db.patchTask(defaultTask.code, { type }).type, type)
      }
      assert.equal(db.patchTask(defaultTask.code, { title: 'Renamed' }).type, 'Analysis')
      const count = db.listTasks().length
      for (const type of ['Other', '', null]) {
        assert.throws(() => db.createTask({ ...input, type }), /Invalid task type/)
        assert.throws(() => db.patchTask(defaultTask.code, { type }), /Invalid task type/)
      }
      assert.equal(db.listTasks().length, count)
      assert.equal(db.getTask(defaultTask.code).type, 'Analysis')
      db.openDatabase(file)
      assert.equal(db.getTask(defaultTask.code).type, 'Analysis')
      assert.equal(db.getTask('OLD-1').type, 'Feature')
    `)
    const result = spawnSync(process.execPath, [join(dir, 'check.mjs'), join(dir, 'tasks.db')], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
