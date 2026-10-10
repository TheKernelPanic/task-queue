import { simpleGit } from 'simple-git'
import type { CommitInfo } from '@shared/types'

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    return await simpleGit(path).checkIsRepo()
  } catch {
    return false
  }
}

/** Most recent commit whose subject is exactly `message`, or null. */
export async function findCommitBySubject(path: string, message: string): Promise<string | null> {
  const SEP = '\x1f'
  const log = await simpleGit(path).raw([
    'log',
    '--fixed-strings',
    `--grep=${message}`,
    `--format=%H${SEP}%s`,
    '-n',
    '20'
  ])
  for (const line of log.split('\n')) {
    const [hash, subject] = line.split(SEP)
    if (hash && subject?.trim() === message) return hash.trim()
  }
  return null
}

/** True if the working tree has uncommitted changes. */
export async function hasChanges(path: string): Promise<boolean> {
  return !(await simpleGit(path).status()).isClean()
}

export async function getCommit(path: string, hash: string): Promise<CommitInfo> {
  const git = simpleGit(path)
  const SEP = '\x1f'
  const header = await git.show(['-s', `--format=%H${SEP}%an${SEP}%aI${SEP}%B`, hash])
  const [fullHash, author, date, ...message] = header.split(SEP)

  const patch = await git.show(['--format=', '--no-color', '--no-ext-diff', hash])
  const files = patch
    .split(/^(?=diff --git )/m)
    .filter((chunk) => chunk.startsWith('diff --git '))
    .map((chunk) => {
      const match = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk)
      return { path: match?.[2] ?? 'unknown', diff: chunk }
    })

  return { hash: fullHash, author, date, message: message.join(SEP).trim(), files }
}
