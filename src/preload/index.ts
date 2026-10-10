import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { Task, TaskEvent, TaskQueueApi, TaskRun } from '@shared/types'

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
  deleteTask: (code) => ipcRenderer.invoke('tasks:delete', code),
  answerQuestion: (code, answer, paths) => ipcRenderer.invoke('tasks:answer', code, answer, paths),
  listProcedures: () => ipcRenderer.invoke('procedures:list'),
  createProcedure: (input) => ipcRenderer.invoke('procedures:create', input),
  updateProcedure: (code, input) => ipcRenderer.invoke('procedures:update', code, input),
  deleteProcedure: (code) => ipcRenderer.invoke('procedures:delete', code),
  listResources: (code) => ipcRenderer.invoke('resources:list', code),
  addResources: (code, paths) => ipcRenderer.invoke('resources:add', code, paths),
  removeResource: (code, name) => ipcRenderer.invoke('resources:remove', code, name),
  listOutputs: (code) => ipcRenderer.invoke('outputs:list', code),
  listAnswerFiles: (code) => ipcRenderer.invoke('answers:list', code),
  openPath: (path) => ipcRenderer.invoke('files:open', path),
  showInFolder: (path) => ipcRenderer.invoke('files:showInFolder', path),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  listRuns: (code) => ipcRenderer.invoke('tasks:runs', code),
  onTaskRun: (cb) => subscribe<TaskRun>('task:run', cb),
  listEvents: (code) => ipcRenderer.invoke('tasks:events', code),
  getCommit: (code) => ipcRenderer.invoke('tasks:commit', code),
  pickPath: (kind) => ipcRenderer.invoke('dialog:pickPath', kind),
  onTaskChanged: (cb) => subscribe<Task>('task:changed', cb),
  onTaskDeleted: (cb) => subscribe<string>('task:deleted', cb),
  onTaskEvent: (cb) => subscribe<TaskEvent>('task:event', cb),
  onTaskDone: (cb) => subscribe<Task>('task:done', cb)
}

contextBridge.exposeInMainWorld('api', api)
