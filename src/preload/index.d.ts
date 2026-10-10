import type { TaskQueueApi } from '@shared/types'

declare global {
  interface Window {
    api: TaskQueueApi
  }
}
