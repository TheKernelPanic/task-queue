import type { TaskType } from '@shared/types'

const ICONS: Record<TaskType, string> = {
  Bug: '🐛',
  Feature: '✨',
  Documentation: '📄',
  Planning: '📋',
  Analysis: '🔍',
  Refactor: '🔧'
}

export default function TaskTypeIcon({ type }: { type: TaskType }) {
  return <span className="task-type-icon" role="img" aria-label={type} title={type}>{ICONS[type]}</span>
}
