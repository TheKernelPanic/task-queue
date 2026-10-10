import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { NewProject, NewTask, TaskStatus, TaskUpdate } from '@shared/types'
import * as db from './db'
import { detectAgents } from './agents'
import { isGitRepo } from './git'
import { startMcpServer } from './mcp'
import * as queue from './queue'

let mainWindow: BrowserWindow | null = null

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
    const task = db.getTask(code)
    if (!task) throw new Error(`Task ${code} not found`)
    if (task.status !== 'Created' && task.status !== 'Stopped') {
      throw new Error(`Only Created or Stopped tasks can be edited`)
    }
    return db.patchTask(code, { title: patch.title, prompt: patch.prompt, agent: patch.agent })
  })
  ipcMain.handle('tasks:setStatus', (_e, code: string, status: TaskStatus) =>
    queue.setStatus(code, status)
  )
  ipcMain.handle('tasks:answer', (_e, code: string, answer: string) =>
    queue.answerQuestion(code, answer)
  )
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
}

app.whenReady().then(async () => {
  db.openDatabase(join(app.getPath('userData'), 'taskqueue.db'))
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
