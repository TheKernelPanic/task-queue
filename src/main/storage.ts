import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import type { TaskFile, TaskFolderKind } from '@shared/types'

/**
 * Internal file storage, one folder per task:
 *   <root>/resources/<TASK>/  files dropped by the user for the agent to use
 *   <root>/outputs/<TASK>/    files the agent produces that don't belong to the project
 *   <root>/answers/<TASK>/    files the user attached when answering the agent's questions
 *   <root>/workspace/<TASK>/  the agent's working directory outside the project (backups, scratch…)
 */
let root: string

const TASK_CODE = /^[A-Z]+-\d+$/

export function initStorage(dir: string): void {
  root = resolve(dir)
  mkdirSync(join(root, 'resources'), { recursive: true })
  mkdirSync(join(root, 'outputs'), { recursive: true })
  mkdirSync(join(root, 'answers'), { recursive: true })
  mkdirSync(join(root, 'workspace'), { recursive: true })
}

export function taskDir(kind: TaskFolderKind, code: string, create: boolean): string {
  if (!TASK_CODE.test(code)) throw new Error(`Invalid task code: ${code}`)
  const dir = join(root, kind, code)
  if (create) mkdirSync(dir, { recursive: true })
  return dir
}

export const resourcesDir = (code: string, create = false) => taskDir('resources', code, create)
export const outputsDir = (code: string, create = false) => taskDir('outputs', code, create)
export const answersDir = (code: string, create = false) => taskDir('answers', code, create)
export const workspaceDir = (code: string, create = false) => taskDir('workspace', code, create)

/** Lists files recursively; `name` is relative to the task folder. */
export function listFiles(dir: string): TaskFile[] {
  return listFilesCapped(dir, Infinity).files
}

/** Like listFiles but stops after `limit` files (working directories can be huge). */
export function listFilesCapped(dir: string, limit: number): { files: TaskFile[]; truncated: boolean } {
  if (!existsSync(dir)) return { files: [], truncated: false }
  const files: TaskFile[] = []
  let truncated = false
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (files.length >= limit) {
        truncated = true
        return
      }
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        const st = statSync(full)
        files.push({
          name: relative(dir, full).split(sep).join('/'),
          path: full,
          size: st.size,
          modifiedAt: st.mtime.toISOString()
        })
      }
    }
  }
  walk(dir)
  return { files: files.sort((a, b) => a.name.localeCompare(b.name)), truncated }
}

function freeName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 1; ; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!existsSync(join(dir, candidate))) return candidate
  }
}

/** Copies files or folders into `dir`, renaming on collision. Returns the absolute target paths. */
function copyInto(dir: string, sources: string[]): string[] {
  return sources.map((source) => {
    const target = join(dir, freeName(dir, basename(source)))
    cpSync(source, target, { recursive: true, errorOnExist: true })
    return target
  })
}

/** Copies files or folders into the task's resources folder. */
export function addResources(code: string, sources: string[]): TaskFile[] {
  const dir = resourcesDir(code, true)
  copyInto(dir, sources)
  return listFiles(dir)
}

/** Copies files attached to an answer into the task's answers folder; returns their absolute paths. */
export function addAnswerFiles(code: string, sources: string[]): string[] {
  return copyInto(answersDir(code, true), sources)
}

/** Deletes every internal folder of a task. */
export function removeTaskFolders(code: string): void {
  for (const dir of [resourcesDir(code), outputsDir(code), answersDir(code), workspaceDir(code)]) {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Resolves a path relative to a task folder, refusing anything that escapes it. */
function inside(dir: string, name: string): string {
  const full = resolve(dir, name)
  if (!full.startsWith(dir + sep)) throw new Error(`Invalid file: ${name}`)
  return full
}

export function removeResource(code: string, name: string): TaskFile[] {
  const dir = resourcesDir(code)
  rmSync(inside(dir, name), { force: true })
  return listFiles(dir)
}

/** True if the path lives inside the internal storage (used to restrict open/reveal from the UI). */
export function isStoragePath(path: string): boolean {
  return resolve(path).startsWith(root + sep)
}
