import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const KEEP_BACKUPS = 10

/**
 * Before the database is opened (and migrated) by a different app version than last time,
 * snapshot it to <dataDir>/backups. VACUUM INTO produces a consistent copy including the WAL.
 */
export function backupOnVersionChange(dataDir: string, dbFile: string, version: string): void {
  const marker = join(dataDir, 'app-version.json')
  const previous = existsSync(marker)
    ? (JSON.parse(readFileSync(marker, 'utf8')) as { version: string }).version
    : null

  if (previous !== version && existsSync(dbFile)) {
    const dir = join(dataDir, 'backups')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(dir, `taskqueue-${previous ?? 'unknown'}-to-${version}-${stamp}.db`)
    const db = new DatabaseSync(dbFile)
    try {
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    } finally {
      db.close()
    }
    console.log(`[backup] ${previous ?? 'unknown'} -> ${version}: ${target}`)

    const old = readdirSync(dir)
      .filter((f) => f.startsWith('taskqueue-') && f.endsWith('.db'))
      .sort()
      .reverse()
      .slice(KEEP_BACKUPS)
    for (const f of old) rmSync(join(dir, f), { force: true })
  }

  writeFileSync(marker, JSON.stringify({ version }))
}
