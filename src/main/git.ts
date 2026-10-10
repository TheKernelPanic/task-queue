import { simpleGit } from 'simple-git'
import type { CommitInfo, Task } from '@shared/types'

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    return await simpleGit(path).checkIsRepo()
  } catch {
    return false
  }
}

/** Stages everything and commits with the task code. Returns the hash, or null if nothing changed. */
export async function commitTask(path: string, task: Task): Promise<string | null> {
  const git = simpleGit(path)
  await git.add('-A')
  const status = await git.status()
  if (status.staged.length === 0 && status.files.length === 0) return null
  const body = task.summary ? `\n\n${task.summary}` : ''
  await git.commit(`${task.code}: ${task.title}${body}`)
  return (await git.revparse(['HEAD'])).trim()
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
