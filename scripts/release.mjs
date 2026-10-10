// Builds a new installer and publishes it to the local releases folder the app checks for updates.
//
//   npm run release            -> bumps patch (0.1.0 -> 0.1.1)
//   npm run release -- minor   -> 0.2.0     (also: major, or an explicit version like 1.4.0)
//
// Releases folder: %USERPROFILE%\TaskQueue\releases (override with TASKQUEUE_RELEASES_DIR).
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const KEEP_INSTALLERS = 3
const bump = process.argv[2] ?? 'patch'
const releasesDir = process.env.TASKQUEUE_RELEASES_DIR ?? join(homedir(), 'TaskQueue', 'releases')
const run = (cmd) => execSync(cmd, { stdio: 'inherit' })

run(`npm version ${bump} --no-git-tag-version`)
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

run('npm run build')
run('npx electron-builder --win --publish never')

const file = `TaskQueue-Setup-${version}.exe`
const built = join('release', file)
if (!existsSync(built)) throw new Error(`Installer not found: ${built}`)

mkdirSync(releasesDir, { recursive: true })
copyFileSync(built, join(releasesDir, file))
const sha512 = createHash('sha512').update(readFileSync(built)).digest('base64')
writeFileSync(
  join(releasesDir, 'latest.json'),
  JSON.stringify({ version, file, sha512, releasedAt: new Date().toISOString() }, null, 2)
)

// Keep only the most recent installers.
const installers = readdirSync(releasesDir)
  .filter((f) => /^TaskQueue-Setup-.+\.exe$/.test(f))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
for (const old of installers.slice(KEEP_INSTALLERS)) rmSync(join(releasesDir, old))

console.log(`\nTaskQueue ${version} published to ${releasesDir}`)
console.log('Open apps will offer the update within 30 minutes (or on next start).')
