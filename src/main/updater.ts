import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateInfo } from '@shared/types'

/**
 * Local-folder updates: `npm run release` writes the NSIS installer and latest.json into the
 * releases folder; the app compares versions and runs the installer silently. The installer only
 * replaces the program files; data lives in %APPDATA%/task-queue and is never touched.
 */
const CHECK_EVERY_MS = 30 * 60 * 1000

interface Manifest {
  version: string
  file: string
  sha512: string
  releasedAt: string
}

export function releasesDir(): string {
  return process.env.TASKQUEUE_RELEASES_DIR ?? join(app.getPath('home'), 'TaskQueue', 'releases')
}

/** -1 / 0 / 1 comparing dotted numeric versions (pre-release suffixes ignored). */
function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map(Number)
  const pb = b.split('-')[0].split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  return 0
}

function readManifest(): Manifest | null {
  const file = join(releasesDir(), 'latest.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Manifest
  } catch {
    return null
  }
}

export function checkForUpdate(): UpdateInfo | null {
  if (!app.isPackaged) return null
  const manifest = readManifest()
  if (!manifest || compareVersions(manifest.version, app.getVersion()) <= 0) return null
  const installer = join(releasesDir(), manifest.file)
  if (!existsSync(installer)) return null
  return { version: manifest.version, releasedAt: manifest.releasedAt }
}

function sha512(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
      .on('error', reject)
  })
}

/** Verifies the installer and runs it silently; the installer closes this app and relaunches it. */
export async function installUpdate(): Promise<void> {
  const manifest = readManifest()
  if (!manifest || !checkForUpdate()) throw new Error('No hay ninguna actualización disponible')
  const installer = join(releasesDir(), manifest.file)
  if ((await sha512(installer)) !== manifest.sha512) {
    throw new Error('El instalador no coincide con latest.json (sha512); vuelve a generar la versión')
  }
  // /S = silent NSIS install, --force-run = start the app again when it finishes.
  spawn(installer, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
  app.quit()
}

export function startUpdateChecks(onAvailable: (info: UpdateInfo) => void): void {
  if (!app.isPackaged) return
  const check = () => {
    const info = checkForUpdate()
    if (info) onAvailable(info)
  }
  setTimeout(check, 5_000)
  setInterval(check, CHECK_EVERY_MS)
}
