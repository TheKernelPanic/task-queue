import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Task, TaskEvent, TaskQueueApi } from '@shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api: TaskQueueApi = {
  listAgents: () => ipcRenderer.invoke('agents:list'),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (input) => ipcRenderer.invoke('projects:create', input),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  listTasks: (projectId) => ipcRenderer.invoke('tasks:list', projectId),
  getTask: (code) => ipcRenderer.invoke('tasks:get', code),
  createTask: (input) => ipcRenderer.invoke('tasks:create', input),
  updateTask: (code, patch) => ipcRenderer.invoke('tasks:update', code, patch),
  setTaskStatus: (code, status) => ipcRenderer.invoke('tasks:setStatus', code, status),
  answerQuestion: (code, answer) => ipcRenderer.invoke('tasks:answer', code, answer),
  listProcedures: () => ipcRenderer.invoke('procedures:list'),
  createProcedure: (input) => ipcRenderer.invoke('procedures:create', input),
  updateProcedure: (code, input) => ipcRenderer.invoke('procedures:update', code, input),
  deleteProcedure: (code) => ipcRenderer.invoke('procedures:delete', code),
  listEvents: (code) => ipcRenderer.invoke('tasks:events', code),
  getCommit: (code) => ipcRenderer.invoke('tasks:commit', code),
  pickPath: (kind) => ipcRenderer.invoke('dialog:pickPath', kind),
  onTaskChanged: (cb) => subscribe<Task>('task:changed', cb),
  onTaskEvent: (cb) => subscribe<TaskEvent>('task:event', cb)
}

contextBridge.exposeInMainWorld('api', api)
