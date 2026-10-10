import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import {
  isTaskEditable,
  TASK_LOCKED_MESSAGE,
  type NewProject,
  type NewTask,
  type ProcedureInput,
  type Task,
  type TaskStatus,
  type TaskUpdate
} from '@shared/types'
import * as db from './db'
import { detectAgents } from './agents'
import { isGitRepo } from './git'
import { startMcpServer } from './mcp'
import * as storage from './storage'
import * as queue from './queue'

let mainWindow: BrowserWindow | null = null

function editableTask(code: string): Task {
  const task = db.getTask(code)
  if (!task) throw new Error(`Task ${code} not found`)
  if (!isTaskEditable(task)) throw new Error(TASK_LOCKED_MESSAGE)
  return task
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'TaskQueue',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('agents:list', () => detectAgents())

  ipcMain.handle('projects:list', () => db.listProjects())
  ipcMain.handle('projects:create', async (_e, input: NewProject) =>
    db.createProject(input, await isGitRepo(input.path))
  )
  ipcMain.handle('projects:delete', (_e, id: number) => db.deleteProject(id))

  ipcMain.handle('tasks:list', (_e, projectId?: number) => db.listTasks(projectId))
  ipcMain.handle('tasks:get', (_e, code: string) => db.getTask(code))
  ipcMain.handle('tasks:create', (_e, input: NewTask) => db.createTask(input))
  ipcMain.handle('tasks:update', (_e, code: string, patch: TaskUpdate) => {
    editableTask(code)
    return db.patchTask(code, {
      title: patch.title,
      prompt: patch.prompt,
      agent: patch.agent,
      procedures: patch.procedures
    })
  })
  ipcMain.handle('tasks:setStatus', (_e, code: string, status: TaskStatus) =>
    queue.setStatus(code, status)
  )
  ipcMain.handle('tasks:answer', (_e, code: string, answer: string, paths: string[]) =>
    queue.answerQuestion(code, answer, paths)
  )
  ipcMain.handle('procedures:list', () => db.listProcedures())
  ipcMain.handle('procedures:create', (_e, input: ProcedureInput) => db.createProcedure(input))
  ipcMain.handle('procedures:update', (_e, code: string, input: ProcedureInput) =>
    db.updateProcedure(code, input)
  )
  ipcMain.handle('procedures:delete', (_e, code: string) => db.deleteProcedure(code))

  ipcMain.handle('resources:list', (_e, code: string) =>
    storage.listFiles(storage.resourcesDir(code))
  )
  ipcMain.handle('resources:add', (_e, code: string, paths: string[]) => {
    editableTask(code)
    return storage.addResources(code, paths)
  })
  ipcMain.handle('resources:remove', (_e, code: string, name: string) => {
    editableTask(code)
    return storage.removeResource(code, name)
  })
  ipcMain.handle('outputs:list', (_e, code: string) => storage.listFiles(storage.outputsDir(code)))
  ipcMain.handle('answers:list', (_e, code: string) => storage.listFiles(storage.answersDir(code)))
  ipcMain.handle('files:open', async (_e, path: string) => {
    if (!storage.isStoragePath(path)) throw new Error('Ruta fuera del almacenamiento interno')
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  ipcMain.handle('files:showInFolder', (_e, path: string) => {
    if (!storage.isStoragePath(path)) throw new Error('Ruta fuera del almacenamiento interno')
    shell.showItemInFolder(path)
  })

  ipcMain.handle('tasks:runs', (_e, code: string) => db.listRuns(code))
  ipcMain.handle('tasks:events', (_e, code: string) => db.listEvents(code))
  ipcMain.handle('tasks:commit', (_e, code: string) => queue.getCommit(code))

  ipcMain.handle('dialog:pickPath', async (_e, kind: 'file' | 'directory') => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: [kind === 'directory' ? 'openDirectory' : 'openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  db.bus.on('task', (task) => mainWindow?.webContents.send('task:changed', task))
  db.bus.on('event', (event) => mainWindow?.webContents.send('task:event', event))
  db.bus.on('run', (run) => mainWindow?.webContents.send('task:run', run))
  db.bus.on('done', (task) => mainWindow?.webContents.send('task:done', task))
}

// The Done chime must play even if the window never received a user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

app.whenReady().then(async () => {
  db.openDatabase(join(app.getPath('userData'), 'taskqueue.db'))
  storage.initStorage(join(app.getPath('userData'), 'storage'))
  await startMcpServer()
  registerIpc()
  queue.startQueue()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => queue.stopAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
